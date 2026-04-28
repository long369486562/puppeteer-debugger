' 创建 WScript.Shell 对象用于运行命令
Dim ws
Set ws = Wscript.CreateObject("Wscript.Shell")

ws.Run "cmd /k bun start",1, False

Set ws = Nothing
WScript.Quit