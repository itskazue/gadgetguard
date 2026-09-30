@echo off
title NCST GadgetGuard - Unified Campus Platform
color 1F

echo ===============================================================
echo   NCST GADGETGUARD - UNIFIED CAMPUS PLATFORM
echo   National College of Science and Technology
echo ===============================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Hindi makita ang Node.js sa computer na ito!
    echo Mangyaring i-download at i-install muna ang Node.js mula sa:
    echo https://nodejs.org/ (Piliin ang LTS version)
    echo.
    echo Pagkatapos ma-install, buksan ulit ang START_SYSTEM.bat na ito.
    echo ===============================================================
    pause
    exit /b
)

:: Check if node_modules exists, if not install dependencies
if not exist "node_modules\" (
    echo [SETUP] Nag-iinstall ng mga kinakailangang package (npm install)...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] May naging problema sa pag-install ng packages.
        pause
        exit /b
    )
    echo [SETUP] Tapos na ang pag-install!
    echo.
)

:: Start the server and automatically launch browser
echo [STARTING] Binubuksan ang NCST GadgetGuard Platform sa Port 3000...
echo.
echo Mga Demo Accounts:
echo - OSA Admin:  osa.admin@univ.edu         / admin123
echo - Student 1:  juan.delacruz@student.univ.edu / student123
echo - Student 2:  maria.santos@student.univ.edu  / student123
echo - Faculty:    prof.reyes@faculty.univ.edu    / faculty123
echo.
echo Website Link: http://localhost:3000/
echo ===============================================================
echo Paalala: Huwag isara ang window na ito habang ginagamit ang website.
echo Pindutin ang Ctrl + C kung nais itong ihinto.
echo ===============================================================

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/"
node server/server.js
pause
