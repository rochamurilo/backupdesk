FROM node:24-bookworm-slim AS extract
RUN apt-get update && apt-get install -y --no-install-recommends p7zip-full && rm -rf /var/lib/apt/lists/*
COPY vendor/restic/restic_0.19.1_linux_amd64.bz2 /tmp/restic.bz2
RUN echo "f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c  /tmp/restic.bz2" | sha256sum -c - && 7z x -so /tmp/restic.bz2 > /tmp/restic && chmod +x /tmp/restic
COPY dist/BackupDesk-Master-0.26.0-x64.exe /tmp/master.exe
RUN 7z x /tmp/master.exe -o/tmp/unpacked -y >/dev/null && find /tmp/unpacked -name 'BackupDesk-Client-0.26.0-x64.exe' -exec cp '{}' /tmp/client.exe \; && test -s /tmp/client.exe && find /tmp/unpacked -name 'BackupDesk-Atualizacao-Client-0.26.0-x64.exe' -exec cp '{}' /tmp/client-update.exe \; && test -s /tmp/client-update.exe


FROM node:24-bookworm-slim AS application
WORKDIR /app
COPY --chown=node:node *.mjs package.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node licenses ./licenses
COPY --chown=node:node --from=extract /tmp/restic ./bin/restic
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_DIR=/data HOST=0.0.0.0 PORT=3000

FROM application AS office
ENV OFFICE_DATA_DIR=/data PORT=3100
CMD ["node", "office-receiver.mjs"]

FROM application AS master
COPY --chown=node:node --from=extract /tmp/client.exe ./dist/BackupDesk-Client-0.26.0-x64.exe
COPY --chown=node:node --from=extract /tmp/client-update.exe ./dist/BackupDesk-Atualizacao-Client-0.26.0-x64.exe
ENV BACKUPDESK_CLOUD_MODE=1
CMD ["node", "server.mjs"]
