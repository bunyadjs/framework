import { type Appearance as Mode, useAppearance } from "@/hooks/use-appearance";
import SettingsLayout from "@/layouts/settings-layout";

const modes: Mode[] = ["light", "dark", "system"];

export default function Appearance() {
  const { appearance, updateAppearance } = useAppearance();

  return (
    <SettingsLayout title="Appearance settings" heading="Appearance" subheading="Update the appearance settings for your account">
      <div className="join" role="radiogroup" aria-label="Appearance">
        {modes.map((mode) => (
          <input key={mode} type="radio" name="appearance" value={mode} className="btn join-item"
            aria-label={mode[0]!.toUpperCase() + mode.slice(1)}
            checked={appearance === mode} onChange={() => updateAppearance(mode)} />
        ))}
      </div>
    </SettingsLayout>
  );
}
