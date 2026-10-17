; ES Desktop Client - custom NSIS include
;
; Prompts the user before deleting the application's saved data
; (connection configs etc.) on uninstall. When the user answers "No",
; the data directory is left intact in %APPDATA%.
;
; The electron-builder NSIS template exposes the customUnInstall
; macro hook after the default uninstall logic, so we can safely
; remove the per-user data dirs that electron-store uses.

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "同时删除应用保存的数据（连接配置等）？$\r$\n$\r$\n选「否」仅卸载程序，数据保留在 %APPDATA% 下。" IDYES delete_app_data IDNO skip_app_data
  delete_app_data:
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif
  skip_app_data:
!macroend
