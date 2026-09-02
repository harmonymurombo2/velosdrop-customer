// declarations.d.ts
declare module 'react-native-bcrypt' {
    interface Bcrypt {
        setRandomFallback: (fallback: (len: number) => number[]) => void;
        genSaltSync: (rounds?: number) => string;
        hashSync: (s: string, salt: string) => string;
        compareSync: (s: string, hash: string) => boolean;
    }
    const bcrypt: Bcrypt;
    export default bcrypt;
}
