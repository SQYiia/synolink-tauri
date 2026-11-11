# Use an installed Android toolchain, or this checkout's local tool cache.
$toolRoot = Join-Path $PSScriptRoot '../.npm-cache/android-tools'
if (!$env:JAVA_HOME) { $env:JAVA_HOME = (Get-ChildItem "$toolRoot/ms-jdk" -Directory -ErrorAction Stop | Select-Object -First 1).FullName }
if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = [IO.Path]::GetFullPath("$toolRoot/sdk") }
if (!$env:NDK_HOME) { $env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk/27.2.12479018' }
$env:GRADLE_USER_HOME = [IO.Path]::GetFullPath("$toolRoot/gradle")
$env:ANDROID_USER_HOME = [IO.Path]::GetFullPath("$toolRoot/android-user")
$env:TEMP = [IO.Path]::GetFullPath("$toolRoot/tmp")
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP,$env:ANDROID_USER_HOME | Out-Null
$env:PATH = "$env:JAVA_HOME/bin;$env:ANDROID_HOME/platform-tools;" + $env:PATH
