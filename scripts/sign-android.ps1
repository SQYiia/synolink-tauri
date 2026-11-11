param([Parameter(Mandatory=$true)][string]$Apk)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/android-env.ps1"
$root = [IO.Path]::GetFullPath("$PSScriptRoot/..")
$signingDir = Join-Path $root '.android-signing'
New-Item -ItemType Directory -Force $signingDir | Out-Null
$key = Join-Path $signingDir 'synolink-release.jks'
$passwordFile = Join-Path $signingDir 'password.txt'
if (!(Test-Path -LiteralPath $key)) {
    if (!(Test-Path -LiteralPath $passwordFile)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $rng.Dispose()
        [IO.File]::WriteAllText($passwordFile, [Convert]::ToBase64String($bytes))
    }
    $env:SYNOLINK_KEY_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
    & "$env:JAVA_HOME/bin/keytool.exe" -genkeypair -keystore $key -alias synolink -keyalg RSA -keysize 3072 -validity 10000 -storepass:env SYNOLINK_KEY_PASSWORD -keypass:env SYNOLINK_KEY_PASSWORD -dname 'CN=SynoLink, OU=Development, O=SynoLink' -noprompt
    if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed' }
}
try {
    $env:SYNOLINK_KEY_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
    $version = (Get-Content "$root/package.json" -Raw | ConvertFrom-Json).version
    $outDir = Join-Path $root 'src-tauri/target/release/bundle/android'
    New-Item -ItemType Directory -Force $outDir | Out-Null
    $output = Join-Path $outDir "SynoLink_${version}_arm64.apk"
    $aligned = Join-Path $outDir 'aligned-unsigned.apk'
    & "$env:ANDROID_HOME/build-tools/36.0.0/zipalign.exe" -f -P 16 4 $Apk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed' }
    & "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" sign --ks $key --ks-key-alias synolink --ks-pass env:SYNOLINK_KEY_PASSWORD --key-pass env:SYNOLINK_KEY_PASSWORD --out $output $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
    & "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose $output
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    Get-FileHash -LiteralPath $output -Algorithm SHA256
} finally { Remove-Item Env:SYNOLINK_KEY_PASSWORD -ErrorAction SilentlyContinue }
