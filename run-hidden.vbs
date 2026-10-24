Option Explicit
Dim fso, sh, base, q, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
q = Chr(34)
cmd = "cmd.exe /c " & q & q & base & "\start.bat" & q & " --hidden" & q
sh.Run cmd, 0, False
