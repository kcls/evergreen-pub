import {UserNamePipe, userNamePart} from './user-name.pipe';

// Stands in for an 'au' IdlObject.
function makeUser(values: {[field: string]: string}): any {
    const user: any = {};
    ['first_given_name', 'second_given_name', 'family_name'].forEach(part => {
        [part, 'pref_' + part].forEach(field => {
            user[field] = () => values[field] === undefined ? null : values[field];
        });
    });
    return user;
}

describe('UserNamePipe', () => {
    const pipe = new UserNamePipe();

    const user = makeUser({
        first_given_name: 'William',
        pref_first_given_name: 'Bill',
        second_given_name: 'Q',
        pref_second_given_name: '',
        family_name: 'Smith'
    });

    it('should prefer the pref value of a name part', () => {
        expect(userNamePart(user, 'first_given_name')).toBe('Bill');
        expect(pipe.transform(user, 'first_given_name')).toBe('Bill');
    });

    it('should fall back to the base value of a name part', () => {
        expect(userNamePart(user, 'second_given_name')).toBe('Q');
        expect(userNamePart(user, 'family_name')).toBe('Smith');
    });

    it('should format a whole name', () => {
        expect(pipe.transform(user)).toBe('Smith, Bill Q');
        expect(pipe.transform(makeUser({family_name: 'Smith'}))).toBe('Smith');
    });

    it('should tolerate a missing user', () => {
        expect(pipe.transform(null)).toBe('');
        expect(pipe.transform(null, 'family_name')).toBe('');
    });
});
