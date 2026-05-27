@echo off
REM Launch GitNexus behind the Elysium splash (opt-in; start.bat remains the
REM plain console default). Adjust ELYSIUM_EXE if you installed it elsewhere.
setlocal
set "ELYSIUM_EXE=%USERPROFILE%\VScode\Elysium\src\Elysium.App\bin\Release\net7.0-windows\Elysium.exe"
if not exist "%ELYSIUM_EXE%" (
    echo Elysium.exe not found at "%ELYSIUM_EXE%".
    echo Build it: cd ..\Elysium ^&^& dotnet build -c Release
    pause
    exit /b 1
)
"%ELYSIUM_EXE%" --manifest "%~dp0elysium.json"
endlocal
