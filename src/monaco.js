    require.config({
      paths: {
        vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs'
      }
    });

    require(['vs/editor/editor.main'], function () {
      // Spatial SQL snippets
      const spatialSnippets = {
        read: `-- Read GeoJSON
SELECT *, ST_AsGeoJSON(geom) AS geojson
FROM ST_Read('d.geojson')
LIMIT 10;;`,

        buffer: `-- Buffer geometries by 200 meters
SELECT
  ST_AsGeojson(
    ST_Transform(
      ST_Buffer(
        ST_Transform(geom, 'EPSG:4326','EPSG:3857'),
        200
      ),
      'EPSG:3857',
      'EPSG:4326'
    )
  ) AS geojson
FROM ST_Read('d.geojson');`,

        area: `-- Calculate area (square meters)
SELECT
  ST_Area(
    ST_Transform(geom, 'EPSG:4326','EPSG:3857')
  ) AS area_m2
FROM ST_Read('your_file.geojson');`,

        centroid: `-- Compute centroid
SELECT
  ST_AsText(ST_Centroid(geom)) AS centroid
FROM ST_Read('your_file.geojson');`,

        bbox: `-- Bounding box
SELECT
  ST_AsText(ST_Envelope(geom)) AS bbox
FROM ST_Read('your_file.geojson');`
      };

      const editor = monaco.editor.create(document.getElementById('editor'), {
        value: `
-- Write your SQL here
-- Go to Eiffel Tower
Select 
  ST_AsGeojson(
  ST_Transform(ST_Buffer(
    ST_Transform(geojson, 'EPSG:4326', 'EPSG:3857'),200
  ),'EPSG:3857', 'EPSG:4326')) as geojson

from values ((ST_GeomFromGEOJSON('
{
  "type": "Point",
  "coordinates": [2.29451510025937, 48.8582718399929]
  
}'::json))) as t (geojson)
`,
        language: 'sql',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14
      });

      // Expose editor immediately after creation
      window.editor = editor;

      // Wire spatial helper buttons
      document.querySelectorAll('.snippet-btn').forEach(btn => {
        btn.className = 'snippet-btn rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700';
        btn.addEventListener('click', () => {
          const key = btn.dataset.snippet;
          const snippet = spatialSnippets[key];
          if (!snippet) return;

          editor.setValue(snippet);
          editor.focus();
        });
      });

      document.getElementById('fileInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!window.registerFile) {
          console.warn('DuckDB not ready yet');
          return;
        }

        await window.registerFile(file);

        // Allow re-selecting the same file again
        e.target.value = '';
      });

      // Execute button -> call DuckDB when ready
      document.getElementById('executeBtn').addEventListener('click', async () => {
        const sql = editor.getValue();

        if (!window.executeSQL) {
          console.warn('DuckDB not ready yet');
          return;
        }

        console.log('Executing SQL via DuckDB:');
        await window.executeSQL(sql);
      });
    });
