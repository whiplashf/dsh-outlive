# 0002 — Ship an in-panel filesystem browser instead of a path field

- Status: accepted
- Date: 2026-11-20

## Context

Users must point the plugin at an agent executable. The obvious interface is a text field, and that is what the prototype did; it is also the interface people get wrong, because the binary is usually not where they think it is and a typo only fails at dispatch time. DSH ships two directory pickers, but both belong to the workspace flow, choose directories only, and require host-side packages this plugin does not control.

## Decision

The host exposes a read-only directory-listing route (`/__outlive/fs`) and the panel renders its own file dialog: breadcrumb, quick locations, filter, hidden-file toggle, executables-only default, and double-click navigation. The chosen path is displayed read-only in the form. The user never types an executable path.

The same dialog, in directory mode, selects a job's working directory.

## Consequences

- The picker works on any machine that can open the panel, with no dependency on a host picker package or a native bridge.
- The route is a filesystem oracle for the user who is already authenticated to this DSH instance. It requires the `x-outlive: 1` header (so a cross-origin page cannot read it via a simple request), lists at most 1000 entries, and follows the same permissions as the host process. It does not write.
- The browser cannot open the OS-native dialog; that capability is only available when the browser and host are the same machine and requires the native picker package. In exchange, the dialog works over SSH and through a public URL.
- Any future host-provided file picker should replace this dialog rather than grow alongside it.
