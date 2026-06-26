'use client';

/**
 * RecetteClient — Interface de test des moteurs ROADSEN.
 *
 * Ce composant :
 *   1. Affiche un sélecteur des 6 moteurs.
 *   2. Génère un formulaire depuis le descripteur statique (engine-descriptors.ts)
 *      — aucune logique de calcul côté navigateur.
 *   3. Lit la clé X-Recette-Key dans sessionStorage (persistée entre navigations
 *      de même session, jamais en dur dans le code).
 *   4. POSTe le corps JSON vers /calc/<moteur> avec X-Recette-Key en en-tête.
 *   5. Affiche la réponse serveur (enveloppe { ok, meta, output } ou erreur HTTP).
 *
 * CONFIDENTIALITÉ DoD §8 : aucun import de @roadsen/engines, aucun calcul local.
 */

import {
  useEffect,
  useReducer,
  useRef,
  type ChangeEvent,
  type FormEvent,
} from 'react';

import {
  ENGINE_DESCRIPTORS,
  findDescriptor,
  type EngineDescriptor,
  type FieldDescriptor,
} from '@/lib/engine-descriptors';

// ---------------------------------------------------------------------------
// Types d'état
// ---------------------------------------------------------------------------

type CalcStatus = 'idle' | 'loading' | 'success' | 'error';

interface State {
  engineId: string;
  recetteKey: string;
  /** Valeurs des champs du formulaire (clé plate = key du descripteur). */
  fieldValues: Record<string, string>;
  status: CalcStatus;
  /** Réponse serveur brute (JSON parsé). */
  result: unknown;
  /** Message d'erreur HTTP ou réseau. */
  errorMessage: string | null;
}

type Action =
  | { type: 'SET_ENGINE'; engineId: string; descriptor: EngineDescriptor }
  | { type: 'SET_KEY'; value: string }
  | { type: 'SET_FIELD'; key: string; value: string }
  | { type: 'CALC_START' }
  | { type: 'CALC_SUCCESS'; result: unknown }
  | { type: 'CALC_ERROR'; message: string };

const SESSION_KEY = 'roadsen_recette_key';

function buildInitialValues(descriptor: EngineDescriptor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of descriptor.fields) {
    if (f.type === 'section') continue;
    out[f.key] = f.example !== undefined ? String(f.example) : '';
  }
  return out;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_ENGINE':
      return {
        ...state,
        engineId: action.engineId,
        fieldValues: buildInitialValues(action.descriptor),
        status: 'idle',
        result: null,
        errorMessage: null,
      };
    case 'SET_KEY':
      return { ...state, recetteKey: action.value };
    case 'SET_FIELD':
      return {
        ...state,
        fieldValues: { ...state.fieldValues, [action.key]: action.value },
      };
    case 'CALC_START':
      return { ...state, status: 'loading', result: null, errorMessage: null };
    case 'CALC_SUCCESS':
      return { ...state, status: 'success', result: action.result };
    case 'CALC_ERROR':
      return { ...state, status: 'error', errorMessage: action.message };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

interface RecetteClientProps {
  apiBaseUrl: string;
}

export default function RecetteClient({ apiBaseUrl }: RecetteClientProps) {
  const firstDescriptor = ENGINE_DESCRIPTORS[0]!;

  const [state, dispatch] = useReducer(reducer, {
    engineId: firstDescriptor.id,
    recetteKey: '',
    fieldValues: buildInitialValues(firstDescriptor),
    status: 'idle',
    result: null,
    errorMessage: null,
  });

  // Restaurer la clé depuis sessionStorage au montage
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY) ?? '';
    if (stored) dispatch({ type: 'SET_KEY', value: stored });
  }, []);

  // Persister la clé à chaque changement
  const prevKey = useRef(state.recetteKey);
  useEffect(() => {
    if (state.recetteKey !== prevKey.current) {
      sessionStorage.setItem(SESSION_KEY, state.recetteKey);
      prevKey.current = state.recetteKey;
    }
  }, [state.recetteKey]);

  const descriptor = findDescriptor(state.engineId) ?? firstDescriptor;

  function handleEngineChange(e: ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const desc = findDescriptor(id);
    if (desc) dispatch({ type: 'SET_ENGINE', engineId: id, descriptor: desc });
  }

  function handleKeyChange(e: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_KEY', value: e.target.value });
  }

  function handleFieldChange(key: string, value: string) {
    dispatch({ type: 'SET_FIELD', key, value });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    dispatch({ type: 'CALC_START' });

    // Construire les valeurs numériques/booléennes depuis les chaînes du formulaire
    const typed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.fieldValues)) {
      if (v === '') { typed[k] = v; continue; }
      if (v === 'true') { typed[k] = true; continue; }
      if (v === 'false') { typed[k] = false; continue; }
      const n = Number(v);
      typed[k] = !isNaN(n) && v.trim() !== '' ? n : v;
    }

    const payload = descriptor.buildPayload(typed);
    const url = `${apiBaseUrl}/calc/${descriptor.id}`;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (state.recetteKey) {
        headers['X-Recette-Key'] = state.recetteKey;
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const json: unknown = await resp.json().catch(() => null);

      if (resp.ok) {
        dispatch({ type: 'CALC_SUCCESS', result: json });
      } else {
        const msg =
          resp.status === 401
            ? `401 — Clé de recette absente ou invalide (${url})`
            : resp.status === 400
              ? `400 — Corps invalide (validation échouée) : ${JSON.stringify(json)}`
              : `Erreur ${resp.status} — ${resp.statusText}`;
        dispatch({ type: 'CALC_ERROR', message: msg });
      }
    } catch (err) {
      dispatch({
        type: 'CALC_ERROR',
        message: `Erreur réseau : ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* En-tête */}
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold text-zinc-900">
            ROADSEN — Test moteurs (recette)
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Surface stateless · calcul serveur · science en cours de validation
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
            {/* Colonne gauche : sélecteur + clé */}
            <aside className="space-y-6">
              {/* Sélecteur de moteur */}
              <fieldset className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <legend className="px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Moteur
                </legend>
                <div className="mt-3">
                  <label
                    htmlFor="engine-select"
                    className="block text-sm font-medium text-zinc-700"
                  >
                    Moteur de calcul
                  </label>
                  <select
                    id="engine-select"
                    value={state.engineId}
                    onChange={handleEngineChange}
                    className="mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                  >
                    {ENGINE_DESCRIPTORS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-zinc-500">{descriptor.description}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">Norme : {descriptor.norme}</p>
                </div>
              </fieldset>

              {/* Clé de recette */}
              <fieldset className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <legend className="px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Accès
                </legend>
                <div className="mt-3">
                  <label
                    htmlFor="recette-key"
                    className="block text-sm font-medium text-zinc-700"
                  >
                    Clé de recette (X-Recette-Key)
                  </label>
                  <input
                    id="recette-key"
                    type="password"
                    value={state.recetteKey}
                    onChange={handleKeyChange}
                    placeholder="Laisser vide si non configurée"
                    autoComplete="off"
                    className="mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                  />
                  <p className="mt-1.5 text-xs text-zinc-400">
                    Stockée en sessionStorage — jamais transmise hors HTTPS.
                  </p>
                </div>
              </fieldset>

              {/* Endpoint affiché */}
              <div className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-500">
                <span className="font-mono">POST {apiBaseUrl}/calc/{state.engineId}</span>
              </div>

              {/* Bouton calculer */}
              <button
                type="submit"
                disabled={state.status === 'loading'}
                className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
              >
                {state.status === 'loading' ? 'Calcul en cours…' : 'Calculer'}
              </button>
            </aside>

            {/* Colonne droite : formulaire + résultat */}
            <div className="space-y-6">
              {/* Formulaire générique */}
              <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Paramètres d&apos;entrée
                </h2>
                <div className="mt-4 space-y-4">
                  <EngineForm
                    descriptor={descriptor}
                    values={state.fieldValues}
                    onChange={handleFieldChange}
                  />
                </div>
              </section>

              {/* Résultat */}
              {state.status !== 'idle' && (
                <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-semibold text-zinc-900">Résultat</h2>
                  <div className="mt-4">
                    {state.status === 'loading' && (
                      <p className="text-sm text-zinc-500">Calcul en cours…</p>
                    )}
                    {state.status === 'error' && (
                      <div
                        data-testid="calc-error"
                        className="rounded-md border border-red-200 bg-red-50 p-4"
                      >
                        <p className="text-sm font-medium text-red-800">Erreur</p>
                        <p className="mt-1 text-sm text-red-700">{state.errorMessage}</p>
                      </div>
                    )}
                    {state.status === 'success' && (
                      <ResultDisplay result={state.result} />
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulaire générique
// ---------------------------------------------------------------------------

interface EngineFormProps {
  descriptor: EngineDescriptor;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

function EngineForm({ descriptor, values, onChange }: EngineFormProps) {
  return (
    <>
      {descriptor.fields.map((field) => {
        if (field.type === 'section') {
          return (
            <div key={field.key} className="pt-4 first:pt-0">
              <h3 className="border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {field.label}
              </h3>
            </div>
          );
        }
        return (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key] ?? ''}
            onChange={onChange}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Champ générique
// ---------------------------------------------------------------------------

interface FieldInputProps {
  field: FieldDescriptor;
  value: string;
  onChange: (key: string, value: string) => void;
}

function FieldInput({ field, value, onChange }: FieldInputProps) {
  const inputId = `field-${field.key}`;
  const labelEl = (
    <label htmlFor={inputId} className="block text-sm font-medium text-zinc-700">
      {field.label}
      {field.unit && (
        <span className="ml-1 font-normal text-zinc-400">({field.unit})</span>
      )}
      {field.optional && (
        <span className="ml-1 text-xs font-normal text-zinc-400">— optionnel</span>
      )}
    </label>
  );

  const baseInputClass =
    'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500';

  let inputEl: React.ReactElement;

  if (field.type === 'select' && field.options) {
    inputEl = (
      <select
        id={inputId}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={baseInputClass}
      >
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'boolean') {
    inputEl = (
      <select
        id={inputId}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={baseInputClass}
      >
        <option value="true">Oui</option>
        <option value="false">Non</option>
      </select>
    );
  } else if (field.type === 'number') {
    inputEl = (
      <input
        id={inputId}
        type="number"
        value={value}
        min={field.min}
        max={field.max}
        step={field.step ?? 'any'}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={baseInputClass}
        placeholder={field.example !== undefined ? String(field.example) : ''}
      />
    );
  } else {
    inputEl = (
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={baseInputClass}
        placeholder={field.example !== undefined ? String(field.example) : ''}
      />
    );
  }

  return (
    <div>
      {labelEl}
      {inputEl}
      {field.hint && (
        <p className="mt-0.5 text-xs text-zinc-400">{field.hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Affichage du résultat
// ---------------------------------------------------------------------------

interface ResultDisplayProps {
  result: unknown;
}

function ResultDisplay({ result }: ResultDisplayProps) {
  if (result === null || result === undefined) {
    return <p className="text-sm text-zinc-500">Aucun résultat.</p>;
  }

  // L'enveloppe attendue : { ok: boolean, meta: {...}, output: {...} } ou { ok: false, error: {...} }
  const envelope = result as Record<string, unknown>;
  const ok = Boolean(envelope['ok']);
  const meta = envelope['meta'] as Record<string, unknown> | undefined;
  const output = envelope['output'];
  const error = envelope['error'];

  return (
    <div data-testid="calc-result" className="space-y-4">
      {/* Statut */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            ok
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {ok ? 'ok : true' : 'ok : false'}
        </span>
        {meta && (
          <span className="text-xs text-zinc-500">
            {String(meta['engineId'])} v{String(meta['engineVersion'])}
          </span>
        )}
      </div>

      {/* Erreur moteur dans l'enveloppe ok:false */}
      {!ok && Boolean(error) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">Erreur moteur</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-red-600">
            {JSON.stringify(error, null, 2)}
          </pre>
        </div>
      )}

      {/* Sortie whitelistée */}
      {output !== undefined && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Résultats
          </p>
          <OutputTable value={output} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tableau récursif des résultats
// ---------------------------------------------------------------------------

function OutputTable({ value }: { value: unknown }) {
  if (value === null) return <span className="text-zinc-400">—</span>;
  if (typeof value === 'boolean') {
    return (
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
          value ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}
      >
        {value ? 'oui' : 'non'}
      </span>
    );
  }
  if (typeof value === 'number') {
    return <span className="font-mono text-sm text-zinc-800">{value}</span>;
  }
  if (typeof value === 'string') {
    return <span className="text-sm text-zinc-800">{value || '—'}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-400">[]</span>;
    return (
      <ol className="list-decimal space-y-2 pl-4">
        {value.map((item, i) => (
          <li key={i}>
            <OutputTable value={item} />
          </li>
        ))}
      </ol>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <table className="w-full border-collapse text-sm">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-zinc-100 last:border-0">
              <td className="py-1.5 pr-4 align-top text-xs font-medium text-zinc-500 w-40">
                {k}
              </td>
              <td className="py-1.5 align-top">
                <OutputTable value={v} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <span className="text-sm text-zinc-800">{String(value)}</span>;
}
