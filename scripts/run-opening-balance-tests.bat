@echo off
REM Step 9.1 Batch F — Test Execution Script (Windows)
REM Run all opening balance import test suites

echo ==========================================
echo Step 9.1 Batch F — Test Execution
echo ==========================================
echo.

REM Set test environment
set NODE_ENV=test

REM Check for .env.test
if not exist .env.test (
    echo Warning: .env.test not found
) else (
    echo Loaded .env.test
)

echo Environment: %NODE_ENV%
echo.

REM Run all opening balance tests
echo Running all opening balance tests...
echo.

npm test -- opening-balances --verbose

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ==========================================
    echo Test execution complete - ALL PASSED
    echo ==========================================
    exit /b 0
) else (
    echo.
    echo ==========================================
    echo Test execution complete - SOME FAILED
    echo ==========================================
    exit /b 1
)
