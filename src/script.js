import * as turf from '@turf/turf'
import maplibregl from 'maplibre-gl';
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const MANUAL_BUNDLES = {
    mvp: {
        mainModule: duckdb_wasm,
        mainWorker: mvp_worker,
    },
    eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: eh_worker,
    },
};
// Select a bundle based on browser checks
const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);

  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger();

  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const conn = await db.connect();

  // Install & load Spatial extension
  // NOTE: Requires running from a proper HTTP origin (not file://)
  await conn.query(`INSTALL spatial;`);
  await conn.query(`LOAD spatial;`);

  console.log('DuckDB spatial extension loaded');

  // ---- MapLibre setup ----
  const MAPTILER_KEY = 'NcKjWCCfscpXY8CdIPaN';

  const map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
    center: [0, 51.3],
    zoom: 8
  });

  map.on('load', () => {
    map.addSource('result', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });

    map.addLayer({
      id: 'result-fill',
      type: 'fill',
      source: 'result',
      paint: {
        'fill-color': '#22c55e',
        'fill-opacity': 0.4
      }
    });

    map.addLayer({
      id: 'result-circle',
      type: 'circle',
      source: 'result',
      paint: {
        'circle-color': '#22c55e',
        'circle-opacity': 0.6
      }
    });

    map.addLayer({
      id: 'result-line',
      type: 'line',
      source: 'result',
      paint: {
        'line-color': '#22c55e',
        'line-width': 2
      }
    });
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  let lastGeoJSON = null;
  let lastTable = null;

  const resetMap = () => {
    lastGeoJSON = null;
    const geoBtn = document.getElementById('downloadGeoJSONBtn');
    const tblBtn = document.getElementById('downloadTableBtn');
    if (geoBtn) geoBtn.classList.add('hidden');
    if (tblBtn) tblBtn.classList.remove('hidden');

    if (map.getSource('result')) {
      map.getSource('result').setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  };

  const updateMapGeoJSON = (geojson) => {
    lastGeoJSON = geojson;
    const geoBtn = document.getElementById('downloadGeoJSONBtn');
    const tblBtn = document.getElementById('downloadTableBtn');
    if (geoBtn) geoBtn.classList.remove('hidden');
    if (tblBtn) tblBtn.classList.add('hidden');

    if (map.getSource('result')) {
      map.getSource('result').setData(geojson);

      try {
        const bbox = turf.bbox(geojson);
        map.fitBounds([[bbox[0], bbox[1]],[bbox[2], bbox[3]]], {
          padding: 40,
          duration: 600
        });
      } catch (e) {
        console.warn('Failed to fit map to GeoJSON bounds', e);
      }
    }
  };

  console.log('DuckDB ready');

  // Expose SQL execution API for Monaco panel
  window.executeSQL = async (sql) => {
    const output = document.getElementById('output');
    output.innerHTML = '<p class="text-slate-400">Executing…</p>';

    try {
      const result = await conn.query(sql);

      const rows = result.toArray();
      const columns = result.schema.fields.map(f => f.name);
      lastTable = { rows, columns };

      // Detect GeoJSON column
      const geojsonCol = columns.find(c => c.toLowerCase().includes('geojson'));
      if (geojsonCol) {
        try {
          const features = rows.map(r => {
            const geometry = JSON.parse(r[geojsonCol]);
            return { type: 'Feature', geometry };
          });
          updateMapGeoJSON({ type: 'FeatureCollection', features });
        } catch (e) {
          console.warn('GeoJSON parse failed, falling back to table', e);
          resetMap();
        }
      } else {
        resetMap();
      }

      if (rows.length === 0) {
        output.innerHTML = '<p class="text-slate-400">Query executed successfully. No rows returned.</p>';
        return;
      }

      let html = '<table class="min-w-full border-collapse">';
      html += '<thead><tr>';
      for (const col of columns) {
        html += `<th class="border-b border-slate-700 px-3 py-2 text-left font-semibold">${col}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (const row of rows) {
        html += '<tr>';
        for (const col of columns) {
          html += `<td class="border-b border-slate-800 px-3 py-1.5">${row[col]}</td>`;
        }
        html += '</tr>';
      }

      html += '</tbody></table>';
      output.innerHTML = html;
    } catch (err) {
      console.error('DuckDB error:', err);
      output.innerHTML = `<pre class="text-red-400 whitespace-pre-wrap">${err}</pre>`;
      resetMap();
    }
  };

  // Download GeoJSON handler
  const downloadGeoBtn = document.getElementById('downloadGeoJSONBtn');
  const downloadTableBtn = document.getElementById('downloadTableBtn');

  if (downloadGeoBtn) {
    downloadGeoBtn.addEventListener('click', () => {
      if (!lastGeoJSON) return;

      const blob = new Blob([JSON.stringify(lastGeoJSON, null, 2)], {
        type: 'application/geo+json'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'result.geojson';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  if (downloadTableBtn) {
    downloadTableBtn.addEventListener('click', () => {
      if (!lastTable || !lastTable.columns) return;

      const { columns, rows } = lastTable;
      const csv = [columns.join(',')]
        .concat(
          rows.map(r =>
            columns.map(c => {
              const v = r[c];
              if (typeof v === 'bigint') return v.toString();
              return JSON.stringify(v ?? '');
            }).join(',')
          )
        )
        .join(`\n`);

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'result.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  };

    const registeredFiles = [];

  window.registerFile = async (file) => {
    console.log('Registering file with DuckDB:', file.name);

    const buffer = await file.arrayBuffer();
    await db.registerFileBuffer(file.name, new Uint8Array(buffer));

    // Track registered files
    if (!registeredFiles.includes(file.name)) {
      registeredFiles.push(file.name);
    }

    const list = document.getElementById('fileList');
    list.innerHTML = '';

    const renderList = () => {
      list.innerHTML = '';
      if (registeredFiles.length === 0) {
        list.innerHTML = '<li class="text-slate-500">No files uploaded</li>';
        return;
      }

      for (const name of registeredFiles) {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between gap-2 font-mono text-xs text-slate-300';

        const span = document.createElement('span');
        span.textContent = name;

        const btn = document.createElement('button');
        btn.textContent = '✕';
        btn.className = 'text-slate-500 hover:text-red-400';
        btn.title = 'Remove file';

        btn.addEventListener('click', async () => {
          try {
            await db.dropFile(name);
          } catch (e) {
            console.warn('Failed to drop file from DuckDB:', e);
          }

          const idx = registeredFiles.indexOf(name);
          if (idx !== -1) registeredFiles.splice(idx, 1);

          const fileInput = document.getElementById('fileInput');
          if (fileInput) fileInput.value = '';

          renderList();
        });

        li.appendChild(span);
        li.appendChild(btn);
        list.appendChild(li);
      }
    };

    renderList();

    const output = document.getElementById('output');
    output.innerHTML = `<p class="text-slate-400">File <strong>${file.name}</strong> registered. You can now query it.</p>`;
  };

  // Smoke test
  const test = await conn.query('SELECT 1 = 1 AS ok');
  console.log('DuckDB smoke test:', test);
