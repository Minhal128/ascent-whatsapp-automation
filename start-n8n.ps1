# Windows entrypoint for n8n, mirroring the EC2 start-n8n.sh: one env file is
# the source of truth, sourced here rather than baked into the environment.
#
#   .\start-n8n.ps1
#
# Stop the n8n you already have running first, or it will hold port 5678.
$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot 'n8n.env'
if (-not (Test-Path $envFile)) {
    throw "n8n.env not found. Copy n8n.env.example to n8n.env and fill it in."
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $i = $line.IndexOf('=')
    if ($i -lt 1) { return }
    $name = $line.Substring(0, $i).Trim()
    $value = $line.Substring($i + 1).Trim()
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

# The whole workflow reads its config through $env expressions, so node access
# to the environment has to be on. Recent n8n defaults this to allowed, but it
# is one flag away from every expression silently resolving to empty.
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'
$env:GENERIC_TIMEZONE = 'Asia/Kolkata'

n8n start
