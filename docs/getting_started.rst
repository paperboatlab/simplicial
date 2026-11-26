Getting started
===============

.. note:: Not written yet: installing with ``paperboat app install simplicial`` once Simplicial is in
   the app registry, opening a station, and a first run.

Ports
-----

The page is served on ``http://127.0.0.1:30471``. Each station runs on its own port, from ``51301``
up: the examples take ``51301`` to ``51310``, and further stations the next free ones.

Files
-----

Simplicial works file by file:

- ``.pst``: a Paperboat Simplicial Station, the definitive station: its code and blocks, the scene
  (the objects, their properties and links), its variables, its starter flow and Board. Simplicial
  never writes one; a new version is packed (``paperboat pack``).
- ``.psf``: a Paperboat Simplicial Flow, a child of one station: only what differs from it (the
  station variables and object properties it changed, objects added or removed, the flow's own
  variables, the flow, the Board, the run settings). It points to its station by name, version and
  a path relative to itself; :doc:`flow_files` has the format.

Simplicial works in a **workspace**: a folder on this computer, or a Malachite hub. With none, the
**Start** page fills the window: Open folder…, Open file…, New flow, Connect to a hub… and Recent
(the folders, hubs and flows you opened last, in every Paperboat app). The workspace is named after
the menu bar; its menu opens another folder, switches the hub, or closes it (back to Start). The
File menu is the same in every app: New flow, Open file… (Ctrl O), Open folder… (Ctrl K Ctrl O),
Open recent, Connect to a hub…, Save (Ctrl S), Save as… (Ctrl Shift S), Close file, Close folder (or
Close hub) and Settings….

- **In a hub**, Open file… and Save as… are Simplicial's own picker over the hub: **By station** shows
  each ``.pst`` with its flows under it wherever they sit, and the flows whose station isn't found
  under **No station**; **Folders** shows the hub's tree.
- **Outside a hub**, Open file… asks: a local file, or Connect to a hub… (without Malachite there are
  no hubs, and it goes straight to the local file). In a Paperboat window the local file, a folder
  and Save as… are your system's dialogs; in a browser you type the path, and Save as… downloads.
- A file opened from **outside the workspace** switches to its folder, or to the hub that holds it.
- **Closing** a flow with changes not saved asks first: Save, Don't save, or Cancel.

The theme and Recent are kept in ``$PAPERBOAT_HOME`` (``recent.json``, ``settings.json``) for every
Paperboat app: a theme picked here is the one every app starts in.

A window works on one station. Opening a flow finds its station: at the flow's path first, then by
name in the hub, among the installed stations (yours and the examples), and the running ones (the
exact version first, then the newest). On this window's station the flow opens at once; on another,
Simplicial asks first: **Switch** starts that station if it isn't running and reopens the window on
it with the flow, **New window** does the same in a new one. Picking a ``.pst`` opens its station on
its starter, a new flow.

What Simplicial says when a flow and its station don't meet:

- **Can't find** the station anywhere it looked: **Find the station…** (a ``.pst`` in the hub; one
  with another name asks before it is used), **Open without a station** (the flow read only, its
  blocks unknown, nothing runs), or Cancel.
- Found **elsewhere** than the flow's path: it opens there, and the flow is marked changed; the
  notification's **Save** keeps the new place.
- Another **version** of the station, or the same one changed since the flow was saved: a warning.
  A change that no longer fits (a variable gone, an object or property renamed, an object of a type
  the station hasn't) is kept in the file, unused, like a lost block; the warning's **Review** keeps
  or removes each. The bell keeps both notifications, their keys too.
- The station **doesn't start** (its build fails, say): the wait screen says why, with **Show log**,
  **Retry** and **Open without a station**.
- Saved in **another hub or folder** than its station's: the flow finds it by name next time.

A value the flow changed of its station's has a dot after its name, in the **Variables** card and in
an object's properties on the Station page; point at it to see the station's value. **Reset to the
station's** (in an open variable; the dot itself on the Station page) puts it back. The Flow's head
names the file; a dot after it means there are changes not saved. **File › New flow** starts again from
what the station started with. The browser also keeps unsaved work as you go: after a reload Simplicial
offers it back (**Restore your last session?**).
