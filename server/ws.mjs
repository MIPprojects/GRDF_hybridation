/**
 * Serveur WebSocket minimal (RFC 6455), sans dépendance.
 * Ne gère que ce dont le mode animateur a besoin : trames texte, ping/pong,
 * fermeture propre. Pas d'extension (permessage-deflate non négocié).
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { SUITE: 0x0, TEXTE: 0x1, BINAIRE: 0x2, FERMETURE: 0x8, PING: 0x9, PONG: 0xa };

export class Connexion extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.ouverte = true;
    this.tampon = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = null;

    socket.on('data', (d) => this.#recevoir(d));
    socket.on('close', () => this.#fermer());
    socket.on('error', () => this.#fermer());
  }

  #fermer() {
    if (!this.ouverte) return;
    this.ouverte = false;
    this.emit('close');
  }

  #recevoir(donnees) {
    this.tampon = Buffer.concat([this.tampon, donnees]);
    // Une trame peut arriver en plusieurs paquets, ou plusieurs par paquet.
    for (;;) {
      const trame = this.#lireTrame();
      if (!trame) break;
      this.#traiter(trame);
    }
  }

  #lireTrame() {
    const b = this.tampon;
    if (b.length < 2) return null;

    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masque = (b[1] & 0x80) !== 0;
    let taille = b[1] & 0x7f;
    let offset = 2;

    if (taille === 126) {
      if (b.length < offset + 2) return null;
      taille = b.readUInt16BE(offset);
      offset += 2;
    } else if (taille === 127) {
      if (b.length < offset + 8) return null;
      const grand = b.readBigUInt64BE(offset);
      if (grand > 4_000_000n) { this.close(1009, 'trame trop grande'); return null; }
      taille = Number(grand);
      offset += 8;
    }

    let cle = null;
    if (masque) {
      if (b.length < offset + 4) return null;
      cle = b.subarray(offset, offset + 4);
      offset += 4;
    }

    if (b.length < offset + taille) return null;

    const charge = Buffer.from(b.subarray(offset, offset + taille));
    if (cle) for (let i = 0; i < charge.length; i++) charge[i] ^= cle[i % 4];

    this.tampon = b.subarray(offset + taille);
    return { fin, opcode, charge };
  }

  #traiter({ fin, opcode, charge }) {
    if (opcode === OP.FERMETURE) { this.close(1000); return; }
    if (opcode === OP.PING) { this.#envoyerTrame(OP.PONG, charge); return; }
    if (opcode === OP.PONG) return;

    if (opcode === OP.SUITE) {
      this.fragments.push(charge);
    } else {
      this.fragments = [charge];
      this.fragmentOp = opcode;
    }
    if (!fin) return;

    const complet = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.fragmentOp === OP.TEXTE) {
      try {
        this.emit('message', JSON.parse(complet.toString('utf8')));
      } catch {
        this.emit('message', null);
      }
    }
  }

  #envoyerTrame(opcode, charge) {
    if (!this.ouverte || this.socket.destroyed) return;
    const taille = charge.length;
    let entete;
    if (taille < 126) {
      entete = Buffer.alloc(2);
      entete[1] = taille;
    } else if (taille < 65536) {
      entete = Buffer.alloc(4);
      entete[1] = 126;
      entete.writeUInt16BE(taille, 2);
    } else {
      entete = Buffer.alloc(10);
      entete[1] = 127;
      entete.writeBigUInt64BE(BigInt(taille), 2);
    }
    entete[0] = 0x80 | opcode; // FIN + opcode, jamais masqué côté serveur
    try {
      this.socket.write(Buffer.concat([entete, charge]));
    } catch { this.#fermer(); }
  }

  envoyer(objet) {
    this.#envoyerTrame(OP.TEXTE, Buffer.from(JSON.stringify(objet), 'utf8'));
  }

  ping() { this.#envoyerTrame(OP.PING, Buffer.alloc(0)); }

  close(code = 1000, raison = '') {
    if (!this.ouverte) return;
    const charge = Buffer.alloc(2 + Buffer.byteLength(raison));
    charge.writeUInt16BE(code, 0);
    charge.write(raison, 2);
    this.#envoyerTrame(OP.FERMETURE, charge);
    this.ouverte = false;
    this.socket.end();
    this.emit('close');
  }
}

/**
 * Branche la poignée de main WebSocket sur un serveur HTTP existant.
 * @param {import('node:http').Server} serveur
 * @param {(connexion: Connexion, requete) => void} surConnexion
 */
export function brancherWebSocket(serveur, surConnexion) {
  serveur.on('upgrade', (req, socket) => {
    const cle = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !cle) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(cle + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    surConnexion(new Connexion(socket), req);
  });
}
