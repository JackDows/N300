param([ValidateSet('Install','Build')][string]$Action,[ValidateSet('Debug','Release')][string]$Configuration='Debug')
& (Join-Path $PSScriptRoot '../sdk/cmake.ps1') -Source $PSScriptRoot -Action $Action -Configuration $Configuration
