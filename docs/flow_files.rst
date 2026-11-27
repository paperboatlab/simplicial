Flow files
==========

A flow file (``name.psf``) is JSON, small enough to read and to diff: a child of one station
(``.pst``), holding only what differs from it. Simplicial writes format 1; it still opens format 0
(full copies of the station's objects and variables) and writes it as format 1 on the next Save.

.. code-block:: json

   {
     "paperboat": 1,
     "station": { "name": "cart-pole", "version": "0.2.0", "sha256": "…", "path": "../cart-pole.pst" },
     "overrides": {
       "variables": { "pole_length": 1.2, "cylinders": 6, "kd": { "expr": "kp / 3" } },
       "objects": { "cart-1": { "props": { "mass": 2.5 }, "links": { "b": null }, "pos": [40, 0] } },
       "added": [{ "id": "probe-1", "type": "probe", "props": { "at": "cyl-6" } }],
       "removed": ["cart-2"]
     },
     "variables": [{ "name": "gain", "type": "number", "value": 40 }],
     "flow": { "nodes": [], "edges": [] },
     "board": { "instruments": [] },
     "run": { "duration": 5 }
   }

``paperboat``
   The format: ``1``. A newer one is refused, and says so.

``station``
   The station it is a child of: its ``station.toml`` ``name`` and ``version``, the ``.pst``'s
   ``sha256`` (a station folder, a station under development, has none), and ``path``, relative to
   the flow file with ``/``, inside the same hub or folder (absent for an installed station, or one
   in another hub).

``overrides``
   What the flow changed of the station's starter (what it sends first: its variables, its objects),
   keyed by name and id. A value equal to the station's is left out, and so is an empty part.

   - ``variables``: a station variable's new value, or, when more than the value changed, the
     fields that did (``null``: removed, as a formula's ``expr`` when it became a value). This is
     also how a flow picks the make-up a station offers: ``cylinders = 6`` builds six, as variables
     are resolved before the station's objects are made.
   - ``objects``: the station's objects the flow changed, by id: ``props``, ``links`` (``null``:
     emptied) and ``pos`` (its place on the Station's Graph view).
   - ``added``: whole objects the user added; ``removed``: the ids of the station's objects the user
     deleted.

``variables``
   The flow's own variables (the station's are in ``overrides``).

``flow``, ``board``, ``run``
   The Flow canvas (groups included), the user's Board layout, and the run settings changed from the
   station's defaults.

Opening one
-----------

The station is found at ``path`` first (when its ``station.toml`` says ``name``), then by ``name`` in
the hub, among the installed stations, and the running ones, the exact ``version`` first, then the
newest. The overrides are applied to the station's starter: the variables, then the objects, removed,
changed and added, sent to the station as one ``variables.set`` and one ``station.set``. One that no
longer fits (a variable or object the station hasn't, a property its type hasn't, an added object of
a type it hasn't) is left out and kept in the file, until it is removed in the warning's **Review**
or a version has it again.

The page's server
-----------------

The page asks the server it was loaded from, for this computer only (a write needs the page's own
``X-Paperboat-Page`` header). A route that reads or writes files takes the workspace as ``hub=<id>``
(a Malachite hub) or ``folder=<absolute path>`` (a folder on this computer), with the same checks:
a path stays inside it, never through a dot entry, and only a ``.psf`` is written.

``GET /__paperboat/workspace``, ``POST`` ``{"folder"}`` | ``{"hub"}`` | ``{"file"}`` | ``{}``
   What the page works in, switched without a restart: ``{"workspace": {"kind": "folder" | "hub",
   "root", "name", "hub"?} | null, "home"}``. A folder inside a hub's is that hub; a file's is its
   folder's (or hub's), and the answer has its ``path`` in it; ``{}`` closes it.

``GET /__paperboat/recent``, ``/__paperboat/settings``; ``POST`` ``{"clear": true}``, ``{"theme"?, "scale"?}``
   The store every Paperboat app shares in ``$PAPERBOAT_HOME`` (else ``$XDG_DATA_HOME/paperboat``,
   else ``~/.local/share/paperboat``): ``recent.json`` (``{"version": 1, "recent": [{"kind", "path",
   "hub"?, "app", "at"}]}``, newest first, one per kind and path, 40 at most; a workspace and every flow
   read or written are added) and ``settings.json`` (``{"version": 1, "theme", "scale"}``: ``scale`` is 0.75, 1 or 1.25), each written whole
   to a temporary file, then renamed.

``GET /__paperboat/hub/files?hub=`` (or ``?folder=``)
   A hub's (or folder's) tree. A ``.pst`` (and a station folder's ``station.toml``) carries ``station``
   ``{name, version}``; a ``.psf`` its ``station`` header, its ``parent`` (the hub path of the station
   it resolves to; ``null`` when it is found nowhere, with ``warn``) for the pickers to nest it under.

``GET`` and ``POST /__paperboat/hub/file?hub=&path=`` (or ``?folder=``)
   A ``.psf`` read, or written (to a temporary file, then renamed).

``GET /__paperboat/station/find?hub=&path=`` (``?folder=&path=``, or ``?name=&version=``)
   ``{"found": {"where": "path" | "workspace" | "installed" | "running", "path", "name", "version",
   "sha256"?, "port"?}}``, or ``{"missing": {"name", "version"?}, "looked": [{"where", "at"?}]}``.

``POST /__paperboat/station/start?hub=&path=`` (``?folder=&path=``, or ``?name=&version=``, an installed one)
   Starts the ``.pst`` or station folder (``paperboat start``) on a free port from ``51301`` and
   answers ``{"port", "url"}``; the page waits on ``/__paperboat/status`` and reads what the start
   wrote from ``GET /__paperboat/station/log?port=``.
