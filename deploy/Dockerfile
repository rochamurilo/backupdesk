FROM node:24-bookworm-slim AS application
WORKDIR /app
COPY --chown=node:node *.mjs package.json ./
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_DIR=/data HOST=0.0.0.0 PORT=3000

FROM application AS office
ENV OFFICE_DATA_DIR=/data PORT=3100
CMD ["node", "office-receiver.mjs"]

FROM node:24-bookworm-slim AS extract
RUN apt-get update && apt-get install -y --no-install-recommends p7zip-full && rm -rf /var/lib/apt/lists/*
COPY dist/BackupDesk-Master-0.20.0-x64.exe /tmp/master.exe
RUN 7z x /tmp/master.exe -o/tmp/unpacked -y >/dev/null && find /tmp/unpacked -name 'BackupDesk-Client-0.20.0-x64.exe' -exec cp '{}' /tmp/client.exe \; && test -s /tmp/client.exe

FROM application AS master
COPY --chown=node:node --from=extract /tmp/client.exe ./dist/BackupDesk-Client-0.20.0-x64.exe
ENV BACKUPDESK_CLOUD_MODE=1
CMD ["node", "server.mjs"]
