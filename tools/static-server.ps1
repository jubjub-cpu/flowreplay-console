param(
  [int]$Port = 4192,
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $NodePath) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { $NodePath = $node.Source }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) { throw "Node.js not found. Pass -NodePath." }
Set-Location -LiteralPath $root
& $NodePath ".\tools\static-server.mjs" --port $Port
