import { useColorScheme } from 'react-native';
import { lightTheme, darkTheme } from '../theme';

export function useAppTheme() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  
  return {
    theme,
    isDark: colorScheme === 'dark',
  };
}
