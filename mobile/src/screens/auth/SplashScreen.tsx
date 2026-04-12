import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, Dimensions,
} from 'react-native';
import { COLORS } from '../../constants';

const { width } = Dimensions.get('window');

interface Props {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: Props) {
  const logoScale   = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const tagOpacity  = useRef(new Animated.Value(0)).current;
  const barWidth    = useRef(new Animated.Value(0)).current;
  const fadeOut     = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // 1. Logo pops in
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 50, friction: 6, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      // 2. Title fades in
      Animated.timing(textOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      // 3. Tagline fades in
      Animated.timing(tagOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      // 4. Loading bar fills
      Animated.timing(barWidth, { toValue: width * 0.6, duration: 1200, useNativeDriver: false }),
      // 5. Hold briefly
      Animated.delay(300),
      // 6. Fade out entire screen
      Animated.timing(fadeOut, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => onFinish());
  }, []);

  return (
    <Animated.View style={[s.container, { opacity: fadeOut }]}>
      {/* Background glow */}
      <View style={s.glow} />

      {/* Logo */}
      <Animated.View style={[s.logoWrap, { transform: [{ scale: logoScale }], opacity: logoOpacity }]}>
        <View style={s.logoCircle}>
          <Text style={s.logoEmoji}>🎱</Text>
        </View>
      </Animated.View>

      {/* App Name */}
      <Animated.View style={{ opacity: textOpacity, alignItems: 'center', gap: 4 }}>
        <Text style={s.appName}>Saturday Nights</Text>
        <Text style={s.appSub}>BILLIARD</Text>
        <View style={s.divider} />
      </Animated.View>

      {/* Tagline */}
      <Animated.Text style={[s.tagline, { opacity: tagOpacity }]}>
        NU Clark · Est. 2024
      </Animated.Text>

      {/* Loading bar */}
      <View style={s.barTrack}>
        <Animated.View style={[s.barFill, { width: barWidth }]} />
      </View>
      <Animated.Text style={[s.loadingText, { opacity: tagOpacity }]}>
        Loading...
      </Animated.Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  glow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: COLORS.primary,
    opacity: 0.06,
    top: '30%',
  },
  logoWrap: {
    marginBottom: 8,
  },
  logoCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: COLORS.surface,
    borderWidth: 3,
    borderColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  logoEmoji: {
    fontSize: 52,
  },
  appName: {
    fontSize: 32,
    fontWeight: '900',
    color: COLORS.textPrimary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  appSub: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 8,
  },
  divider: {
    width: 60,
    height: 2,
    backgroundColor: COLORS.primary,
    borderRadius: 1,
    marginTop: 8,
  },
  tagline: {
    fontSize: 13,
    color: COLORS.textMuted,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  barTrack: {
    width: width * 0.6,
    height: 3,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 16,
  },
  barFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  loadingText: {
    fontSize: 11,
    color: COLORS.textMuted,
    letterSpacing: 2,
  },
});
