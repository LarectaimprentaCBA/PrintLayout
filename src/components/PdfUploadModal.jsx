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
  const [name, setName] = useState('');
  const [categoria, setCategoria] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setMargin(String(defaultMargin));
      setDoubleSided(defaultDoubleSided);
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
      doubleSided,
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
            Margen entre el borde de la hoja y las marcas L (mm)
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
