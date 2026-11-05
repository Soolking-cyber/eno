#!/bin/bash
# A screen only this login uses. Ends when login.mjs ends, so the window is not left open.
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
sleep 1
x11vnc -display :99 -forever -shared -nopw -localhost -rfbport 5900 -quiet >/dev/null 2>&1 &
websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/dev/null 2>&1 &
sleep 1
cd /app && node login.mjs
