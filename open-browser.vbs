Option Explicit
Dim url
If WScript.Arguments.Count = 0 Then WScript.Quit 1
url = WScript.Arguments(0)
' ShellExecute with normal window state: the browser opens visibly,
' while wscript itself is hidden.
CreateObject("Shell.Application").ShellExecute url, "", "", "open", 1
