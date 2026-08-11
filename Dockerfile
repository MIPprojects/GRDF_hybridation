# Prototype sans aucune dépendance npm : l'image se résume au runtime Node
# et aux fichiers du projet.
FROM node:22-alpine

WORKDIR /app
COPY . .

# Cloud Run injecte PORT ; le serveur le lit déjà (process.env.PORT).
ENV NODE_ENV=production
EXPOSE 8080

USER node
CMD ["node", "server/server.mjs"]
