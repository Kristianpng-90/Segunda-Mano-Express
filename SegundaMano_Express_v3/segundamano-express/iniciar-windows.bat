@echo off
title SegundaMano Express
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas instalar Node.js desde https://nodejs.org (version LTS) y volver a abrir este archivo. & pause & exit /b)
start "" http://localhost:3000
node server.js
pause
