step
====

The path of a Step flow (``flows = ["step"]``): control passes along step wires from one block to the
next. Hats start a path: ``start`` once, ``when`` each time its signal ``cond`` rises. Then
``wait``, ``repeat`` (leaves by ``loop`` ``times`` times, then by ``done``), ``while``, ``say``,
``join`` and ``stop``, which ends the whole run. To branch, use a `base <../base/>`_ logic
block in its step form. See `Flows <https://paperboatlab.github.io/paperboat/flow.html>`_.

.. toctree::
   :maxdepth: 1

   blocks/index
