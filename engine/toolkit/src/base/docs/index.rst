base
====

What every domain needs, in every flow type: values of each datatype, keys, type
conversions, time and logic. Import it in a descriptor with ``import = ["base"]``.

.. toctree::
   :maxdepth: 1

   blocks/index

Values and keys
---------------

``constant`` (Number: a float, param ``value``), ``text`` (Text: a string) and ``boolean``
(Boolean: a checkbox, 1 or 0 on the wire); all output ``y``. ``variable`` reads a project
variable by its ``name`` (live while the run goes, if the variable is tunable). ``key`` is 1 while
its ``key`` param's key is held in the UI, and ``key_hold`` also says for how long.

Conversions
-----------

``to_number``, ``to_text`` and ``to_boolean`` turn any value into one type (a text that is not a
number gives ``to_number``'s ``fallback``); ``type_of`` names what arrived: ``"number"``,
``"text"``, ``"vector"``, ``"table"``, ``"handle"`` or ``"empty"``.

Vectors
-------

``mux`` joins one signal input per name into a vector, and ``demux`` splits one. Their ``names``
param (``"x v theta"``, space- or comma-separated) gives the ports, in order, and the vector's
dimension and component labels; ``units`` (``"m m/s rad"``, ``-`` for none) gives each a unit by
position, so units are checked on both sides. A name twice, one that isn't an identifier, ``y`` on
a Mux or ``u`` on a Demux, or more than 64 names fail the run on the block. Between a Mux and a
Demux any `elementwise <https://paperboatlab.github.io/paperboat/concepts.html#elementwise>`_ block works on the whole vector.

Time
----

``now`` gives the run clock in milliseconds, ``interval`` a 1 every ``interval`` ms between
``start`` and ``stop``, ``timeout`` a 1 once ``delay`` ms have passed since ``reset``, and
``delay`` its input ``delay`` ms late (no feedthrough).

Logic
-----

The logic blocks are **magic blocks**: each has two forms, picked by its ``form`` param, and takes
the ports of the one picked. In the **signal** form it computes; in the **step** form it sits on a
Step flow's path (``in``) and branches, leaving by ``yes`` when its test holds, else ``no``. A
value holds when it is positive (a key held, a threshold over its level).

.. list-table::
   :header-rows: 1

   * - Block
     - signal form
     - step form
   * - ``if``
     - ``cond``, ``a``, ``b`` → ``y``: ``a`` while ``cond`` holds, else ``b`` (any value)
     - ``in``, ``cond`` → ``yes``, ``no``
   * - ``and``, ``or``
     - ``a``, ``b``… → ``y``: 1 or 0 (more inputs with ``inputs``)
     - ``in``, ``a``, ``b``… → ``yes``, ``no``
   * - ``xor``
     - ``a``, ``b`` → ``y``: holds when exactly one input holds
     - ``in``, ``a``, ``b`` → ``yes``, ``no``
   * - ``not``
     - ``u`` → ``y``
     - ``in``, ``u`` → ``yes``, ``no``
   * - ``compare``
     - ``a``, ``b`` → ``y``; ``op``: > >= < <= == !=
     - ``in``, ``a``, ``b`` → ``yes``, ``no``
   * - ``in_range``
     - ``u``, ``min``, ``max`` → ``y``: holds when ``min <= u <= max``
     - ``in``, ``u``, ``min``, ``max`` → ``yes``, ``no``
