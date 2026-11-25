Writing a station
=================

A station is a ``descriptor.toml`` and its domain code. The engine loads it, and the page gets
everything it shows (blocks, station objects, the starter graph, the scene) from the engine.

C++ stations
------------

.. note:: Not written yet: ``Block``, ``StationObject``, the descriptor, building against the engine.

Python and Julia stations
-------------------------

Python and Julia stations run out of process, in Paperboat's runtimes, over
``paperboat-runtime/0``.

.. note:: Not written yet: waits for the out-of-process hosts.

Toolkits
--------

.. note:: Not written yet: the built-in toolkit and the optional ``simplicial-toolkit-*`` packages.
