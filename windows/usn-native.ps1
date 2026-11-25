# Read-only NTFS metadata. Also installed in the protected VSS component folder.
# No journal creation/deletion, arbitrary commands, or privileged file reads.
if (-not ('BackupDeskUsn' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class BackupDeskUsn {
 [StructLayout(LayoutKind.Sequential)] struct Info {
  public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created,Accessed,Written;
  public uint Serial,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle handle,uint code,byte[] input,int inputSize,byte[] output,int outputSize,out int returned,IntPtr overlapped);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,StringBuilder name,int nameSize,out uint serial,out uint maxComponent,out uint flags,StringBuilder filesystem,int filesystemSize);
 public sealed class Journal {
  public string journal_id,first_usn,next_usn,lowest_valid_usn,serial;
 }
 static SafeFileHandle Open(string name,uint access,uint share) {
  SafeFileHandle h=CreateFile(name,access,share,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
  if(h.IsInvalid){int error=Marshal.GetLastWin32Error();h.Dispose();throw new IOException("USN handle unavailable (Windows "+error+")");} return h;
 }
 public static Journal Query(string device,uint serial) {
  // Called by the SYSTEM worker only for the snapshot it has just created.
  using(SafeFileHandle h=Open(device,0x80000000,7)) {
   byte[] b=new byte[80];int n;
   if(!DeviceIoControl(h,0x000900f4,null,0,b,b.Length,out n,IntPtr.Zero)||n<56)throw new IOException("USN journal unavailable (Windows "+Marshal.GetLastWin32Error()+")");
   return new Journal {journal_id=BitConverter.ToUInt64(b,0).ToString(),first_usn=BitConverter.ToInt64(b,8).ToString(),next_usn=BitConverter.ToInt64(b,16).ToString(),lowest_valid_usn=BitConverter.ToInt64(b,24).ToString(),serial=serial.ToString()};
  }
 }
 static string Time(System.Runtime.InteropServices.ComTypes.FILETIME t){return (((ulong)(uint)t.dwHighDateTime<<32)|(uint)t.dwLowDateTime).ToString();}
 static string Stamp(SafeFileHandle h) {
  Info info;if(!GetFileInformationByHandle(h,out info)||(info.Attributes&0x410)!=0)throw new IOException("USN requires regular non-reparse file");
  byte[] b=new byte[4096];int n;
  if(!DeviceIoControl(h,0x000900eb,null,0,b,b.Length,out n,IntPtr.Zero)||n<60||BitConverter.ToUInt16(b,4)!=2||BitConverter.ToUInt32(b,0)>n)throw new IOException("Unsupported USN record");
  ulong id=((ulong)info.IndexHigh<<32)|info.IndexLow;
  long usn=BitConverter.ToInt64(b,24);
  if(id!=BitConverter.ToUInt64(b,8)||usn<=0)throw new IOException("USN identity unavailable");
  return info.Serial+"\t"+id+"\t"+usn+"\t"+(((ulong)info.SizeHigh<<32)|info.SizeLow)+"\t"+Time(info.Written)+"\t"+Time(info.Created);
 }
 public static string Pair(string snapshot,string live) {
  // Opening the LIVE file without FILE_SHARE_WRITE/DELETE refuses current
  // writers, including handles with unclosed/coalesced USN changes. Snapshot
  // metadata alone is not sufficient proof that a cached hash is reusable.
  using(SafeFileHandle l=Open(live,0x80000000,1))
  using(SafeFileHandle s=Open(snapshot,0x80000000,7)) {
   string a=Stamp(l),b=Stamp(s);if(a!=b)throw new IOException("Live/snapshot identity differs");return b;
  }
 }
 public static void Stream() {
  string line;
  while((line=Console.ReadLine())!=null) {
   string[] parts=line.Split('\t');int index;
   if(line.Length>65536||parts.Length!=3||!Int32.TryParse(parts[0],out index)||index<0)throw new IOException("Invalid USN input");
   string result="-";
   try {
    string snapshot=Encoding.UTF8.GetString(Convert.FromBase64String(parts[1]));
    string live=Encoding.UTF8.GetString(Convert.FromBase64String(parts[2]));
    if(!System.Text.RegularExpressions.Regex.IsMatch(snapshot,@"^\\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy\d+\\",System.Text.RegularExpressions.RegexOptions.IgnoreCase)||!System.Text.RegularExpressions.Regex.IsMatch(live,@"^[A-Za-z]:\\"))throw new IOException("Local VSS paths required");
    result=Pair(snapshot,live);
   } catch { /* Per-file failure always falls back to hashing snapshot data. */ }
   Console.WriteLine(index+"\t"+result);
  }
 }
}
'@
}
