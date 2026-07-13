@echo off
REM ================================================================
REM  把 dist/ 一键部署到 Cloudflare Pages
REM  第一次会跳浏览器要你登录 Cloudflare (没账号就免费注册一个)
REM  完成后会输出公网 URL，复制去 pwabuilder.com 生成 APK
REM ================================================================

setlocal
cd /d "%~dp0\.."

echo.
echo [1/3] 检查 dist/ ...
if not exist "dist\index.html" (
    echo    dist/ 不存在或不完整，先跑一次 build
    call npm run build || goto :err
)
echo    dist/ OK

echo.
echo [2/3] 登录 Cloudflare ^(第一次会跳浏览器^) ...
call npx wrangler whoami 2>nul | findstr /C:"You are logged in" >nul
if errorlevel 1 (
    call npx wrangler login || goto :err
) else (
    echo    已登录
)

echo.
echo [3/3] 部署到 Cloudflare Pages ...
echo    project name: medbox-pwa
call npx wrangler pages deploy dist --project-name=medbox-pwa --commit-dirty=true
if errorlevel 1 goto :err

echo.
echo ================================================================
echo  部署完成。
echo  把上方输出的 https://xxx.pages.dev URL 复制粘贴到：
echo      https://www.pwabuilder.com
echo  点 Start → 输入 URL → Package For Stores → Android → Generate
echo  下载 .apk 安装到安卓机即可。
echo ================================================================
exit /b 0

:err
echo.
echo *** 部署失败，看上面的报错 ***
exit /b 1
