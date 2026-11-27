import { useEffect, useRef, useState } from 'react';

export default function PdfUploadModal({
  open,
  fileName,
  defaultMargin = 10,
  defaultDoubleSided = false,
  existingCategories = [],
  onConfirm,
  onCancel,
}) {
  const [margin, setMargin] = useState(String(defaultMargin));
  const [doubleSided, setDoubleSided] = useState(defaultDoubleSided);
  // 'comun' = plantilla de siempre (las marcas vienen en el PDF).
  // 'tags'  = plancha de tags (frente + dorso + lugar del logo + corte; las
  //           marcas y el QR los pone la app).
  const [tipo, setTipo] = useState('comun');
  const [name, setName] = useState('');
  const [categoria, setCategoria] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setMargin(String(defaultMargin));
      setDoubleSided(defaultDoubleSided);
      setTipo('comun');
      // Default: nombre del archivo sin .pdf
      const baseName = (fileName || '').replace(/\.pdf$/i, '').trim();
      setName(baseName);
      setCategoria('');
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, defaultMargin, defaultDoubleSided, fileName]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    onConfirm?.({
      margin,
      doubleSided: tipo === 'tags' ? false : doubleSided,
      tags: tipo === 'tags',
      name: name.trim(),
      categoria: categoria.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        className="w-96 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-ink-100">Cargar plantilla</h3>
        {fileName && (
          <p className="mt-1 truncate text-xs text-ink-400" title={fileName}>
            {fileName}
          </p>
        )}

        <div className="mt-3 flex gap-1 rounded border border-ink-700 bg-ink-800 p-0.5 text-xs" data-campo="tipoPlantilla">
          {[['comun', 'Plantilla común'], ['tags', 'Plancha de tags']].map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              data-tipo={val}
              onClick={() => {
                setTipo(val);
                // Las marcas las dibuja la app: arranca con el margen de las grillas.
                if (val === 'tags' && String(margin) === String(defaultMargin)) setMargin('15');
                if (val === 'comun' && String(margin) === '15') setMargin(String(defaultMargin));
                // Las planchas de tags van juntas en su carpeta, así se eligen
                // mirando las miniaturas.
                if (val === 'tags' && !categoria.trim()) setCategoria('Tags');
                if (val === 'comun' && categoria === 'Tags') setCategoria('');
              }}
              className={`flex-1 rounded px-2 py-1 ${tipo === val ? 'bg-accent-600 text-white' : 'text-ink-300 hover:bg-ink-700'}`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {tipo === 'tags' && (
          <div className="mt-2 rounded border border-accent-500/30 bg-accent-500/5 px-2 py-1.5 text-[11px] leading-snug text-ink-300">
            El PDF tiene que traer <b>4 páginas del mismo tamaño</b> (el de la hoja):
            <ol className="ml-4 mt-1 list-decimal space-y-0.5">
              <li>Frente: los tags ya acomodados, sin marcas.</li>
              <li>Dorso: tal como se imprime.</li>
              <li>Un rectángulo donde va el logo de cada tag.</li>
              <li>El corte: la silueta de cada tag (y el agujero, si lo lleva).</li>
            </ol>
            <p className="mt-1 text-ink-400">Las marcas y el QR los pone la app.</p>
          </div>
        )}

        <label className="mt-4 block text-xs text-ink-300">
          <span className="block mb-1">Nombre</span>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel?.();
            }}
            placeholder="Nombre de la plantilla"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
          />
        </label>

        <label className="mt-3 block text-xs text-ink-300">
          <span className="block mb-1">Carpeta (opcional)</span>
          <input
            list="pdf-upload-categorias"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel?.();
            }}
            placeholder="Sin carpeta — ej: Fotos, Tarjetas"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
          />
          <datalist id="pdf-upload-categorias">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="mt-3 block text-xs text-ink-300">
          <span className="block mb-1">
            {tipo === 'tags'
              ? 'Margen entre el borde de la hoja y las marcas (mm)'
              : 'Margen entre el borde de la hoja y las marcas L (mm)'}
          </span>
          <input
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel?.();
            }}
            placeholder="10"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
          />
        </label>

        {tipo !== 'tags' && (
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-ink-200">
          <input
            type="checkbox"
            checked={doubleSided}
            onChange={(e) => setDoubleSided(e.target.checked)}
            className="h-4 w-4 accent-accent-500"
          />
          <span>
            Plantilla doble faz
            <span className="ml-1 text-ink-500">
              (frente con marcas, dorso sin marcas)
            </span>
          </span>
        </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500"
          >
            Cargar
          </button>
        </div>
      </form>
    </div>
  );
}
