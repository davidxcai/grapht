'use client';

import { useTheme } from '@/lib/theme-provider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

export function ThemeSelector() {
  const { theme, setTheme, mounted } = useTheme();

  if (!mounted) {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor="theme">Theme</Label>
        <div className="h-10 rounded-md border border-input bg-background" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="theme">Theme</Label>
      <Select value={theme} onValueChange={(value: unknown) => setTheme(value as 'light' | 'dark' | 'system')}>
        <SelectTrigger id="theme" className="w-full">
          <span>
            {theme === 'light' && 'Light'}
            {theme === 'dark' && 'Dark'}
            {theme === 'system' && 'System'}
          </span>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="system">System</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
