Option Explicit
On Error Resume Next
If WScript.Arguments.Count <> 2 Then WScript.Quit 1
Dim shell, command, result
Set shell = CreateObject("WScript.Shell")
command = Chr(34) & WScript.Arguments(0) & Chr(34) & " " & Chr(34) & WScript.Arguments(1) & Chr(34)
' Keep the task alive while Node runs, without creating a visible console.
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then WScript.Quit 1
WScript.Quit result
