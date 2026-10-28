param([ValidateSet('Test','Dev','Build','Package')][string]$Task='Dev', [string[]]$TestArgs=@())
$ErrorActionPreference='Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$rustBin = Join-Path $projectRoot '.tools\rustup\toolchains\stable-x86_64-pc-windows-gnu\bin'
$llvmRoot = Join-Path $projectRoot '.tools\llvm-mingw-20261020-msvcrt-x86_64'
if (!(Test-Path -LiteralPath (Join-Path $rustBin 'cargo.exe'))) { throw 'Portable Rust is unavailable. Use the standard MSVC toolchain described in README.md.' }
$env:CARGO_HOME = Join-Path $projectRoot '.tools\cargo'
$env:RUSTUP_HOME = Join-Path $projectRoot '.tools\rustup'
$env:PATH = "$rustBin;$(Join-Path $llvmRoot 'bin');$env:PATH"
$llvmLib = (Join-Path $llvmRoot 'x86_64-w64-mingw32\lib').Replace('\','/')
$gccLib = (Join-Path $projectRoot '.tools\rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\lib\self-contained').Replace('\','/')
$env:RUSTFLAGS = "-L native=$llvmLib -L native=$gccLib"
Push-Location -LiteralPath $projectRoot
try {
  switch ($Task) {
    'Test' { cargo test --manifest-path src-tauri/Cargo.toml -p qinghe-core @TestArgs }
    'Dev' { npm.cmd run desktop }
    'Build' { npm.cmd run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol }
    'Package' {
      $previousSigningKey = $env:TAURI_SIGNING_PRIVATE_KEY
      $previousSigningPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
      try {
        if (!$env:TAURI_SIGNING_PRIVATE_KEY) {
          $keyPath = Join-Path $projectRoot '.keys\qinghe-updater.key'
          if (!(Test-Path -LiteralPath $keyPath)) { throw 'Missing updater signing key. See docs/desktop-updates.md.' }
          $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
          $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
        }
        npm.cmd run desktop:build
      } finally {
        $env:TAURI_SIGNING_PRIVATE_KEY = $previousSigningKey
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousSigningPassword
      }
    }
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
