$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BackupDeskFolderPicker {
 [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IShellItem {
  void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
  void GetParent(out IShellItem parent);
  void GetDisplayName(uint kind, out IntPtr name);
  void GetAttributes(uint mask, out uint attributes);
  void Compare(IShellItem item, uint hint, out int order);
 }
 [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IFileOpenDialog {
  [PreserveSig] int Show(IntPtr owner);
  void SetFileTypes(uint count, IntPtr types);
  void SetFileTypeIndex(uint index);
  void GetFileTypeIndex(out uint index);
  void Advise(IntPtr events, out uint cookie);
  void Unadvise(uint cookie);
  void SetOptions(uint options);
  void GetOptions(out uint options);
  void SetDefaultFolder(IShellItem folder);
  void SetFolder(IShellItem folder);
  void GetFolder(out IShellItem folder);
  void GetCurrentSelection(out IShellItem item);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
  void GetFileName(out IntPtr name);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
  void GetResult(out IShellItem item);
  void AddPlace(IShellItem item, uint alignment);
  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
  void Close(int result);
  void SetClientGuid(ref Guid guid);
  void ClearClientData();
  void SetFilter(IntPtr filter);
  void GetResults(out IntPtr items);
  void GetSelectedItems(out IntPtr items);
 }
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 public static string Select() {
  object instance=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("dc1c5a9c-e88a-4dde-a5a1-60f82a20aef7")));
  IShellItem item=null; IntPtr text=IntPtr.Zero;
  try {
   IFileOpenDialog dialog=(IFileOpenDialog)instance; uint options;dialog.GetOptions(out options);
   dialog.SetOptions(options | 0x20u | 0x40u | 0x800u | 0x02000000u);
   dialog.SetTitle(Environment.GetEnvironmentVariable("BACKUPDESK_PICKER_TITLE") ?? "Selecione uma pasta"); dialog.SetOkButtonLabel("Selecionar pasta");
   int result=dialog.Show(GetForegroundWindow());
   if(result==unchecked((int)0x800704C7))return null;
   Marshal.ThrowExceptionForHR(result);dialog.GetResult(out item);item.GetDisplayName(0x80058000u,out text);
   return Marshal.PtrToStringUni(text);
  } finally {if(text!=IntPtr.Zero)Marshal.FreeCoTaskMem(text);if(item!=null)Marshal.ReleaseComObject(item);Marshal.ReleaseComObject(instance);}
 }
}
'@
try {
 $folder=[BackupDeskFolderPicker]::Select()
 @{path=$folder;cancelled=($null -eq $folder)} | ConvertTo-Json -Compress
} catch {
 [Console]::Error.WriteLine($_.Exception.Message)
 exit 1
}
