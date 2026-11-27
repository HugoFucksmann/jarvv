/** Primera línea de los scripts de PowerShell de las herramientas nativas: su salida sale en UTF-8 sin BOM. */
export const PS_UTF8_PREFIX = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)";
