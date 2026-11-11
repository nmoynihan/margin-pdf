import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { skins } from '../../../src/renderer/src/skins'
import { chromeAPI } from './chrome'
import { forgetPositions, type Preferences } from './storage'

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
        <button className="primary-button" onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>
  )
}
