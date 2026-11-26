@echo off
rem HDR test build (#66): starts the game with HDR10 output. Options go after the name, for example
rem   "Play with HDR.bat" -PaperWhite 250 -Peak 800
rem See order1886_test_hdr.ps1 (same folder) for all options.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0order1886_test_hdr.ps1" %*
pause
