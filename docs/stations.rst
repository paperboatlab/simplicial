Writing a station
=================

A station is a ``descriptor.toml`` and its domain code. The engine loads it, and the page gets
everything it shows (blocks, station objects, the starter graph, the scene) from the engine.

C++ stations
------------

.. note:: Not written yet: ``Block``, ``StationObject``, the descriptor, building against the engine.

Python and Julia stations
-------------------------

The engine is always the station: it loads the descriptor, checks and runs the graph, integrates
the models and serves the page. A Python or Julia station adds only its domain code, one file that
runs in a Paperboat runtime (``python@3.12`` or ``julia@1.11``) which ``paperboatd`` starts for it:
in a container (podman, then docker; no network, a read-only root), or as a process on the host
when there is no container backend. The engine calls the code over ``paperboat-runtime/0``; nothing
of Python or Julia is loaded into it.

.. code-block:: sh

   paperboat new demo --python     # or --julia: station.toml, descriptor.toml, station.py, expected.json
   paperboat run demo              # serve it on ws://localhost:51312 and open it in Simplicial
   paperboat check demo            # manifest, catalog, protocol smoke test, golden run

The first start pulls the runtime's image, which takes a while; later starts take a second or two.

The files
~~~~~~~~~

``station.toml``
   ``language = "python"`` or ``"julia"``, and ``run``: the domain file (``station.py``,
   ``station.jl``), relative to the station's folder. ``[run]`` sets what a C++ station sets in
   code: the run's ``duration`` and ``dt``, ``mode`` (``"clock"``, or ``"once"``: the Flow
   evaluated once), ``emit_every`` (signals and the scene every N steps), ``speed`` (times real
   time) and the ``solver``; ``[view]`` is the scene's camera hint (``mode = "2d"``, ``center``,
   ``height``; or ``mode = "3d"`` and a ``camera``).

``descriptor.toml``
   As for any station: the packages it imports, its starter graph and station. Its ``domain`` is
   the package the file's types join, so the palette has them without listing them.

``station.py`` / ``station.jl``
   Classes (Python) or structs (Julia), each registered with a name and a definition. The name is
   the type the descriptor and the flow use.

.. code-block:: python

   import paperboat_runtime as pb

   class Scale:
       def __init__(self, gain=2.0):          # the params, as keywords
           self.gain = gain

       def step(self, ctx, inputs):           # once per pass of the clock
           pb.log(f"t = {ctx['t']}")           # a Console line
           return {"y": self.gain * inputs.get("u", 0.0)}

   pb.register("scale", Scale, definition={
       "label": "Scale", "inputs": ["u"], "outputs": ["y"], "params": {"gain": 2.0},
   })

.. code-block:: julia

   struct Scale
       gain::Float64
   end
   Scale(; gain = 2.0) = Scale(gain)
   step(b::Scale, ctx, inputs) = Dict("y" => b.gain * get(inputs, "u", 0.0))

   PaperboatRuntime.register("scale", Scale; definition = Dict(
       "label" => "Scale", "inputs" => ["u"], "outputs" => ["y"], "params" => [("gain", 2.0)]))

A Julia ``Dict`` has no order: give params (and props) as a list of ``(id, default)`` pairs to keep
the order the card shows. Python keeps a dict's order.

The definition
~~~~~~~~~~~~~~

``base``
   What the type is: ``"block"`` (the default), ``"step"`` (a block on a Step flow's path),
   ``"object"`` (a station object) or ``"model"`` (a station object the engine's solver integrates).

``label``, ``description``
   What the palette and the card show.

``kind``
   A block's ``"function"`` (the default), ``"source"``, ``"probe"`` or ``"monitor"`` (with
   ``instrument``, the Board face that shows it: ``"graph"``, ``"display"`` …).

``inputs``, ``outputs``
   Ports: a name (``"u"``), or ``{"id", "type", "unit", "dimension", "components"}``.

``params`` (a block), ``props`` (an object)
   ``{"id": default}``, ``[("id", default)]`` or ``[{"id", "default", "type", "options", "unit"}]``.
   The default says the type: a number, ``true``/``false`` (a checkbox), text; ``type`` names the
   others (``"enum"`` with ``options``, ``"key"``, ``"file"``, ``"variable"``).

``feedthrough``, ``elementwise``, ``flows``
   As for a C++ block. A block with ``"feedthrough": false`` answers ``current()`` with its outputs
   from its state alone, and takes its inputs in ``step`` after the pass.

``links``, ``role``, ``block`` (an object)
   The slots other objects fill, ``"body"`` or ``"joint"``, and its linked block
   (``{"inputs", "outputs", "kind"}``, a probe by default), which has the object's id on the Flow.

``solver`` (a model)
   Its solver when its ``solver`` prop doesn't say: ``"auto"`` (the run's), ``"rk4"`` …

What the engine calls
~~~~~~~~~~~~~~~~~~~~~

Python calls ``instance.method(*args)``; Julia ``method(instance, args...)``, a function of the
station file. Optional methods may be left out: the engine remembers that a type lacks one.

============  =======================================  ========================================
base          required                                 optional
============  =======================================  ========================================
block         ``step(ctx, inputs) -> outputs``         ``current() -> outputs``, ``entities()``
step          ``tick(ctx, inputs) -> port``            ``enter(ctx, inputs)``, ``outputs()``,
                                                       ``may_start()``, ``ends_run()``,
                                                       ``restarts()``, ``shared()``
object        –                                        ``read() -> outputs``, ``step(ctx, inputs)``,
                                                       ``entities(id, z)``, ``link(slot)``
model         ``initial() -> x``,                      ``read(x) -> outputs``,
              ``derivatives(t, x, inputs) -> dx``      ``entities(id, z, x)``
============  =======================================  ========================================

``ctx`` is ``{"t", "dt", "id", "keys"?}``: the run clock, the step, the block's id on the Flow and
the keys held down. Inputs and outputs are ``{port: value}``: numbers, lists of numbers, tables
(lists of rows) or text; an unwired input is absent. ``port`` is the step output to leave by
(``""`` stays). ``entities`` returns the shapes to draw, ``[{"id", "shape", "pos", "size", "rot",
"color", …}]`` (ids prefixed with the object's ``id``, at depth ``z``). A model's state lives in the
engine's solver, so ``read`` and ``entities`` get it as ``x``.

``log(text, level)`` (Python ``paperboat_runtime.log``, Julia ``PaperboatRuntime.log(text; level)``)
writes a Console line while the engine waits for the call; ``print`` goes to the runtime's own log
(``paperboat runtime logs <instance>``). An error in the code fails the run with its message and the
block's id, and its traceback goes to the station's output; the station keeps going. Opaque handles
(images, meshes) don't travel to a runtime.

Packages and lifetime
~~~~~~~~~~~~~~~~~~~~~

A station's packages live in its runtime's package volume, kept per project and never in the image
or on the host: ``paperboat package add python numpy --project <station>`` (``julia`` likewise);
``paperboat deps install`` says so. A Python station file imports the station's other modules (its
folder is on ``sys.path``); a Julia one ``include``\s them.

The runtime starts with the station and ends with it: stopping the station (or Ctrl+C) ends the
runtime and its container goes, so the next start loads edited code fresh. A station that is killed leaves its runtime idle, and
``paperboatd`` removes it after its idle timeout. A runtime that crashes fails the run in progress;
the next run starts it again. Every call crosses a socket (tens of microseconds), so a model's
``derivatives`` is the expensive part; the shared-memory fast path and coarser calls (RFC pb#438 §7)
come later.

Toolkits
--------

.. note:: Not written yet: the built-in toolkit and the optional ``simplicial-toolkit-*`` packages.
