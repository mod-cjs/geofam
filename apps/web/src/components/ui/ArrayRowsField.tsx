'use client';

/**
 * ArrayRowsField — champ de saisie multi-lignes dynamique.
 *
 * Rendu d'un tableau éditable pour les champs de type 'array-rows' du descripteur moteur.
 * L'état est ENTIÈREMENT contrôlé par le parent via :
 *   - value : JSON.stringify(Row[]) — stocké dans formValues[field.key]
 *   - onChange(json: string) : appelé à chaque modification (ajout, suppression, édition cellule)
 *
 * Ce composant ne contient aucune logique de calcul.
 * DoD §8 : aucun import @roadsen/engines.
 */

import type { FieldDescriptor } from '@/lib/engine-descriptors';

export interface ArrayRowsFieldProps {
  field: FieldDescriptor;
  /** Valeur courante : JSON.stringify d'un tableau de Record<string, string>. */
  value: string;
  /** Appelé à chaque changement avec le nouveau JSON sérialisé. */
  onChange: (json: string) => void;
  /** Message d'erreur affiché sous le tableau. */
  error?: string;
}

type Row = Record<string, string>;

/** Parse safe du JSON ; retourne [] si invalide ou pas un tableau. */
function parseRows(json: string): Row[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as Row[];
  } catch {
    // JSON malformé → tableau vide, le fallback ci-dessous s'applique
  }
  return [];
}

/** Construit une ligne vide à partir des exemples des colonnes. */
function makeDefaultRow(columns: FieldDescriptor[]): Row {
  const row: Row = {};
  for (const col of columns) {
    row[col.key] = col.example !== undefined ? String(col.example) : '';
  }
  return row;
}

export function ArrayRowsField({ field, value, onChange, error }: ArrayRowsFieldProps) {
  const columns = field.columns ?? [];
  const minRows = field.minRows ?? 1;

  // Dériver les lignes depuis le JSON contrôlé
  let rows = parseRows(value);
  // Si JSON vide ou malformé, on affiche au moins une ligne de secours (non-crash)
  if (rows.length === 0) {
    rows = [makeDefaultRow(columns)];
  }

  function update(newRows: Row[]) {
    onChange(JSON.stringify(newRows));
  }

  function addRow() {
    update([...rows, makeDefaultRow(columns)]);
  }

  function removeRow(i: number) {
    if (rows.length <= minRows) return; // contrainte minRows : ne pas descendre en dessous
    update(rows.filter((_, j) => j !== i));
  }

  function updateCell(rowIdx: number, colKey: string, val: string) {
    update(rows.map((row, i) => (i === rowIdx ? { ...row, [colKey]: val } : row)));
  }

  return (
    <div style={{ gridColumn: '1 / -1' }} data-testid="array-rows-field">
      {/* Label du champ */}
      <div
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--text-primary)',
          marginBottom: 8,
        }}
      >
        {field.label}
        {field.hint && (
          <span
            style={{
              fontWeight: 400,
              color: 'var(--text-muted)',
              fontSize: 'var(--text-xs)',
              marginLeft: 8,
            }}
          >
            {field.hint}
          </span>
        )}
      </div>

      {/* Tableau */}
      <div style={{ overflowX: 'auto', marginBottom: 8 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 'var(--text-sm)',
          }}
          aria-label={field.label}
        >
          <thead>
            <tr
              style={{
                background: 'var(--surface-canvas)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              {/* Colonne numéro de ligne */}
              <th
                style={{
                  padding: '4px 6px',
                  textAlign: 'center',
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  width: 28,
                  userSelect: 'none',
                }}
              >
                #
              </th>

              {/* Colonnes de données */}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    padding: '6px 8px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    minWidth: 72,
                  }}
                >
                  {col.label}
                  {col.unit ? ` (${col.unit})` : ''}
                  {col.optional ? '' : ' *'}
                </th>
              ))}

              {/* Colonne action supprimer */}
              <th style={{ width: 32, padding: '4px 6px' }} aria-label="Actions" />
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {/* Numéro de ligne */}
                <td
                  style={{
                    padding: '4px 6px',
                    textAlign: 'center',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    userSelect: 'none',
                  }}
                >
                  {rowIdx + 1}
                </td>

                {/* Cellules de données */}
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: '3px 4px' }}>
                    {col.type === 'select' && col.options ? (
                      <select
                        value={row[col.key] ?? ''}
                        onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                        aria-label={`${col.label} couche ${rowIdx + 1}`}
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          border: '1px solid var(--border-default, #d1d5db)',
                          borderRadius: 'var(--radius-base, 4px)',
                          fontSize: 'var(--text-sm)',
                          background: 'var(--surface-base, #fff)',
                          color: 'var(--text-primary)',
                          minWidth: 80,
                        }}
                      >
                        {col.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={col.type === 'number' ? 'number' : 'text'}
                        value={row[col.key] ?? ''}
                        onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                        min={col.min}
                        max={col.max}
                        step={col.type === 'number' ? 'any' : undefined}
                        aria-label={`${col.label} couche ${rowIdx + 1}`}
                        placeholder={
                          col.example !== undefined ? String(col.example) : undefined
                        }
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          border: '1px solid var(--border-default, #d1d5db)',
                          borderRadius: 'var(--radius-base, 4px)',
                          fontSize: 'var(--text-sm)',
                          background: 'var(--surface-base, #fff)',
                          color: 'var(--text-primary)',
                          minWidth: 56,
                          boxSizing: 'border-box',
                        }}
                      />
                    )}
                  </td>
                ))}

                {/* Bouton supprimer */}
                <td style={{ padding: '3px 4px', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => removeRow(rowIdx)}
                    disabled={rows.length <= minRows}
                    aria-label={`Supprimer la couche ${rowIdx + 1}`}
                    data-testid={`array-rows-remove-${rowIdx}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: rows.length <= minRows ? 'not-allowed' : 'pointer',
                      color:
                        rows.length <= minRows
                          ? 'var(--text-muted)'
                          : 'var(--status-fail-tx, #dc2626)',
                      fontSize: 16,
                      lineHeight: 1,
                      padding: '0 4px',
                      opacity: rows.length <= minRows ? 0.35 : 1,
                      fontFamily: 'monospace',
                    }}
                  >
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bouton ajout de ligne */}
      <button
        type="button"
        onClick={addRow}
        data-testid="array-rows-add"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          background: 'var(--surface-canvas)',
          border: '1px dashed var(--border-default, #d1d5db)',
          borderRadius: 'var(--radius-base, 4px)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          transition: 'background var(--dur-fast, 100ms) ease',
        }}
      >
        + Ajouter une couche
      </button>

      {/* Message d'erreur */}
      {error && (
        <div
          role="alert"
          style={{
            color: 'var(--status-fail-tx, #dc2626)',
            fontSize: 'var(--text-xs)',
            marginTop: 6,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
