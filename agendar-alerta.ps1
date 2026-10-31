# Agenda (ou atualiza) a tarefa diaria que envia o resumo de contas a pagar por e-mail.
param([string]$Hora = '08:00')
$ErrorActionPreference = 'Stop'
$pasta = $PSScriptRoot
$acao = New-ScheduledTaskAction -Execute (Join-Path $pasta 'enviar-alerta.bat') -WorkingDirectory $pasta
$gatilho = New-ScheduledTaskTrigger -Daily -At $Hora
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'Openway Financeiro - Alerta diario' -Action $acao -Trigger $gatilho -Settings $config `
  -Description 'Envia por e-mail o resumo das contas a pagar do dia (Openway Financeiro)' -Force | Out-Null
Write-Host " Tarefa agendada para todos os dias as $Hora."
