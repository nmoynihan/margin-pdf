import { useEffect, useRef, useState } from 'react'
import { Palette, PanelsTopLeft, X } from 'lucide-react'
import { defaultLayout, type SessionSnapshot, type WorkspaceLayout } from '../../../shared/types'
import { SkinBrowser } from './SkinBrowser'
import { skinDefinition } from '../skins'

export type Preferences = Pick<SessionSnapshot, 'skin' | 'theme' | 'layout'>

const fields: { key: keyof WorkspaceLayout; label: string; hint: string; values: string[] }[] = [
  {
    key: 'controls',
    label: 'Application controls',
    hint: 'Logo, Open PDF and Options',
    values: ['top', 'left', 'bottom'],
  },
  {
    key: 'tabs',
    label: 'Document tabs',
    hint: 'Your open PDF documents',
    values: ['top', 'bottom', 'left', 'right'],
  },
  {
    key: 'sidebar',
    label: 'Sidebar position',
    hint: 'Outline and page thumbnails',
    values: ['left', 'right', 'overlay'],
  },
  {
    key: 'documentTools',
    label: 'Document toolbar',
    hint: 'Search, split view, reload and print',
    values: ['top', 'bottom'],
  },
  {
    key: 'pageControls',
    label: 'Page controls',
    hint: 'Page number, zoom and navigation',
    values: ['top', 'bottom'],
  },
]

const presets: { name: string; layout: WorkspaceLayout }[] = [
  { name: 'Standard', layout: defaultLayout() },
  {
    name: 'Editorial',
    layout: { ...defaultLayout(), tabs: 'bottom', sidebar: 'right', documentTools: 'bottom' },
  },
  { name: 'Document rail', layout: { ...defaultLayout(), tabs: 'left' } },
  { name: 'Command column', layout: { ...defaultLayout(), controls: 'left' } },
  {
    name: 'Reading dock',
    layout: { ...defaultLayout(), controls: 'bottom', sidebar: 'overlay', pageControls: 'bottom' },
  },
]

export function Options({
  current,
  onPreview,
  onSave,
  onClose,
}: {
  current: Preferences
  onPreview(preferences: Preferences): void
  onSave(preferences: Preferences): void
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [section, setSection] = useState<'appearance' | 'layout'>('appearance')
  const [draft, setDraft] = useState(current)
  useEffect(() => {
    content.current?.scrollTo(0, 0)
  }, [section])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    return () => {
      element.close()
      previous?.focus({ preventScroll: true })
    }
  }, [])
  const update = (patch: Partial<Preferences>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onPreview(next)
  }
  return (
    <dialog
      ref={dialog}
      className="options-dialog"
      aria-labelledby="options-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className="options-header">
        <h2 id="options-title">Options</h2>
        <button className="icon-button" aria-label="Close options" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <div className="options-body">
        <nav
          className="options-nav"
          role="tablist"
          aria-label="Options sections"
          aria-orientation="vertical"
        >
          {(['appearance', 'layout'] as const).map((tab, index) => (
            <button
              key={tab}
              role="tab"
              id={`options-${tab}-tab`}
              aria-controls={`options-${tab}`}
              aria-selected={section === tab}
              tabIndex={section === tab ? 0 : -1}
              onClick={() => setSection(tab)}
              onKeyDown={(event) => {
                if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault()
                  const next =
                    event.key === 'Home'
                      ? 'appearance'
                      : event.key === 'End'
                        ? 'layout'
                        : index === 0
                          ? 'layout'
                          : 'appearance'
                  setSection(next)
                  document.getElementById(`options-${next}-tab`)?.focus()
                }
              }}
            >
              {tab === 'appearance' ? <Palette size={16} /> : <PanelsTopLeft size={16} />}
              {tab === 'appearance' ? 'Appearance' : 'Layout'}
            </button>
          ))}
        </nav>
        <div className="options-content" ref={content}>
          <section
            role="tabpanel"
            id="options-appearance"
            aria-labelledby="options-appearance-tab"
            hidden={section !== 'appearance'}
          >
            <div className="options-section-heading">
              <h3>Appearance</h3>
              <label>
                Colour theme{' '}
                <select
                  aria-label="Options colour theme"
                  value={draft.theme}
                  onChange={(event) =>
                    update({ theme: event.target.value as Preferences['theme'] })
                  }
                >
                  <option value="system">Follow system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </div>
            <h4>Skins</h4>
            <SkinBrowser selected={draft.skin} onSelect={(skin) => update({ skin })} />
            <p className="options-description">{skinDefinition(draft.skin).description}</p>
          </section>
          <section
            role="tabpanel"
            id="options-layout"
            aria-labelledby="options-layout-tab"
            hidden={section !== 'layout'}
          >
            <div className="options-section-heading">
              <h3>Layout</h3>
              <button className="text-button" onClick={() => update({ layout: defaultLayout() })}>
                Reset layout
              </button>
            </div>
            <div className="layout-presets" role="group" aria-label="Layout presets">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  aria-pressed={JSON.stringify(draft.layout) === JSON.stringify(preset.layout)}
                  onClick={() => update({ layout: { ...preset.layout } })}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <div className="layout-fields">
              {fields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <small>{field.hint}</small>
                  <select
                    aria-label={field.label}
                    value={draft.layout[field.key]}
                    onChange={(event) =>
                      update({ layout: { ...draft.layout, [field.key]: event.target.value } })
                    }
                  >
                    {field.values.map((value) => (
                      <option key={value} value={value}>
                        {value === 'overlay' ? 'Overlay' : value[0].toUpperCase() + value.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        </div>
      </div>
      <footer className="options-footer">
        <button className="text-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" onClick={() => onSave(draft)}>
          Save options
        </button>
      </footer>
    </dialog>
  )
}
