/**
 * Petit client WebSocket partagé par l'animateur et les joueurs :
 * reconnexion automatique et aiguillage des messages par type.
 */
export function connecterSalon({ surOuverture, surMessage, surFermeture } = {}) {
  const protocole = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket = null;
  let vivant = true;
  let tentatives = 0;
  let minuteur = null;

  function ouvrir() {
    socket = new WebSocket(`${protocole}//${location.host}`);

    socket.addEventListener('open', () => {
      tentatives = 0;
      surOuverture?.();
    });

    socket.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && typeof msg.type === 'string') surMessage?.(msg);
    });

    socket.addEventListener('close', () => {
      if (!vivant) return;
      surFermeture?.(tentatives);
      // temporisation croissante, plafonnée à 6 s
      const delai = Math.min(6000, 600 * 2 ** tentatives);
      tentatives += 1;
      minuteur = setTimeout(ouvrir, delai);
    });

    socket.addEventListener('error', () => socket.close());
  }

  ouvrir();

  return {
    envoyer(objet) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(objet));
    },
    get pret() { return socket?.readyState === WebSocket.OPEN; },
    fermer() { vivant = false; clearTimeout(minuteur); socket?.close(); },
  };
}
