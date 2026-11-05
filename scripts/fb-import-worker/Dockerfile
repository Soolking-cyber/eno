# The Facebook reader on the box. Real Chrome, no disguise. noVNC is only so a person can log in by hand in this browser (start-login.sh): the session is created here, never copied here.
FROM mcr.microsoft.com/playwright:v1.62.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc novnc websockify xvfb && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json login.mjs worker.mjs reader.mjs start-login.sh ./
RUN npm i --silent playwright@1.62.0 && npx playwright install chrome && chmod +x start-login.sh
