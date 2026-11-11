import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { skins } from '../../../src/renderer/src/skins'
import { chromeAPI } from './chrome'
import { forgetPositions, type Preferences } from './storage'
import { normalizeTitleDomains, titlePermissions, type TitleMode } from './title-rules'

export function Settings({
  preferences,
  onChange,
  onClose,
  onError,
}: {
  preferences: Preferences
  onChange(value: Preferences): void
  onClose(): void
  onError(message: string): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [enabled, setEnabled] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [titleMode, setTitleMode] = useState(preferences.titleMode)
  const [titleDomains, setTitleDomains] = useState(preferences.titleDomains.join('\n'))
  const latestPreferences = useRef(preferences)
  latestPreferences.current = preferences
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    void chromeAPI.mimeHandler
      ?.getMimeHandlerOptions('application/pdf')
      .then((options) => setEnabled(options.enabled !== false))
      .catch((error) => onError(error.message))
    return () => {
      element.close()
      previous?.focus()
    }
  }, [onError])
  return (
    <dialog
      ref={dialog}
      className="browser-settings"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2 id="settings-title">Reader settings</h2>
        <button className="icon-button" aria-label="Close settings" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <label>
        Colour theme
        <select
          value={preferences.theme}
          onChange={(event) =>
            onChange({ ...preferences, theme: event.target.value as Preferences['theme'] })
          }
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        Skin
        <select
          value={preferences.skin}
          onChange={(event) =>
            onChange({ ...preferences, skin: event.target.value as Preferences['skin'] })
          }
        >
          {skins.map((skin) => (
            <option key={skin.id} value={skin.id}>
              {skin.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check-setting">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === undefined || busy}
          onChange={async (event) => {
            const value = event.target.checked
            setEnabled(value)
            setBusy(true)
            try {
              await chromeAPI.mimeHandler!.setMimeHandlerOptions('application/pdf', {
                enabled: value,
              })
            } catch (error) {
              setEnabled(!value)
              onError((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        />
        Open PDFs in Margin PDF
      </label>
      <p>Applies to PDFs you open next, including PDFs embedded in webpages.</p>
      <fieldset className="title-settings">
        <legend>PDF tab titles</legend>
        <label>
          Chrome tab title
          <select
            aria-label="Chrome tab title"
            value={titleMode}
            disabled={busy}
            onChange={(event) => setTitleMode(event.target.value as TitleMode)}
          >
            <option value="website">Keep website title</option>
            <option value="domains">PDF title on selected domains</option>
            <option value="all">PDF title on all websites</option>
          </select>
        </label>
        {titleMode === 'domains' && (
          <label className="domain-setting">
            Domains (including subdomains)
            <textarea
              aria-label="Title domains"
              rows={3}
              value={titleDomains}
              disabled={busy}
              onChange={(event) => setTitleDomains(event.target.value)}
            />
          </label>
        )}
        <p>
          Changes the Chrome tab title for full-page PDFs. Embedded PDFs keep the surrounding page's
          title.
        </p>
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            try {
              const domains =
                titleMode === 'domains'
                  ? normalizeTitleDomains(titleDomains)
                  : latestPreferences.current.titleDomains
              if (titleMode === 'domains' && !domains.length)
                throw new Error('Enter at least one domain.')
              const origins = titlePermissions(titleMode, domains)
              setBusy(true)
              if (origins.length && !(await chromeAPI.permissions.request({ origins }))) {
                setMessage('Site access was not granted. Title settings were not changed.')
                return
              }
              onChange({ ...latestPreferences.current, titleMode, titleDomains: domains })
              setMessage('Tab title settings saved.')
            } catch (reason) {
              setMessage((reason as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          Apply title settings
        </button>
      </fieldset>
      <label className="check-setting">
        <input
          type="checkbox"
          checked={preferences.remember}
          onChange={(event) => onChange({ ...preferences, remember: event.target.checked })}
        />
        Remember reading positions on this device
      </label>
      <p>
        Stores positions for up to 100 PDFs, identified by a fingerprint of their contents. PDF
        contents, filenames and URLs are never saved.
      </p>
      <button
        className="text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await forgetPositions()
            setMessage('Saved reading positions cleared.')
          } catch (error) {
            onError((error as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Clear saved reading positions
      </button>
      <p role="status">{message}</p>
      <footer>
        <a href="privacy.html" target="_blank" rel="noreferrer">
          Privacy policy
        </a>
        <a href="https://github.com/nmoynihan/margin-pdf" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <button className="primary-button" onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>
  )
}
