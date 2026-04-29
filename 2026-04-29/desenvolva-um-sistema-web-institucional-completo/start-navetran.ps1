$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'

if (Test-Path $BundledNode) {
  & $BundledNode (Join-Path $ProjectRoot 'server.js')
} else {
  node (Join-Path $ProjectRoot 'server.js')
}
