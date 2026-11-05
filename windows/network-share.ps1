$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.Encoding]::UTF8
try {
 $text=[Console]::In.ReadToEnd()
 if($text.Length -gt 16384){exit 1}
 $request=$text | ConvertFrom-Json
 if($request.root -notmatch '^\\\\[^\\/:*?"<>|\x00-\x1f]+\\[^\\/:*?"<>|\x00-\x1f]+$' -or -not $request.username -or -not $request.password){exit 1}
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BackupDeskNetwork {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
 private struct NETRESOURCE {public int scope,type,display,usage;public string local,remote,comment,provider;}
 [DllImport("mpr.dll",CharSet=CharSet.Unicode,EntryPoint="WNetAddConnection2W")]
 private static extern int Add(ref NETRESOURCE resource,string password,string username,int flags);
 public static int Connect(string remote,string username,string password){var resource=new NETRESOURCE();resource.type=1;resource.remote=remote;return Add(ref resource,password,username,4);}
}
'@
 $code=[BackupDeskNetwork]::Connect([string]$request.root,[string]$request.username,[string]$request.password)
 [Console]::Out.Write([string]$code)
} catch {exit 1}
