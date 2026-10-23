---
title: Validation
description: Validate input with rule strings, form requests, and the validator, then show the errors.
---

# Validation

## Introduction

`validate` checks a data object against rules and returns the fields that passed. A failure throws `ValidationException`.

An HTML form is redirected back to the previous URL. The session receives the error messages and the old input, with `password` removed. The next page reads them with `@error` and `old`. See [Views](/docs/1.x/views).

A request that [expects JSON](/docs/1.x/requests) gets 422 instead of a redirect:

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "email": ["The email field is required."]
  }
}
```

Import the helpers from `@bunyad/validation`.

`validate` also works in a plain Bun script with no session or Form Request — see [using packages alone](/docs/1.x/standalone).

## Validation quickstart

### Defining the routes

Show the form with `GET`. Store it with `POST`. Both routes belong to the `web` group so the session, and therefore the redirect back, exists.

```ts
Route.get("/users/create", () => view("users.create"));
Route.post("/users", [UserController, "store"]);
```

### Creating the controller

```ts title="app/Http/Controllers/UserController.ts"
import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { validate } from "@bunyad/validation";

export default class UserController {
  async store(request: Request) {
    const data = await validate(request.all(), {
      name: "required|string|max:255",
      email: "required|email",
      password: "required|string|min:8|confirmed",
    });

    await createUser(data);

    request.session?.flash("status", "User created.");
    return redirect("/users");
  }
}
```

`validate` throws before `createUser` runs. You do not write the failure branch yourself for the common case.

### Writing the validation logic

Rules are a string of names separated by `|`, or an array. Parameters follow a colon.

```ts
await validate(request.all(), {
  title: "required|string|max:255",
  body: ["required", "string"],
  tags: "nullable|array",
});
```

`Rule` builds the same strings in code:

```ts
import { Rule, validate } from "@bunyad/validation";

await validate(request.all(), {
  email: [Rule.required(), Rule.email()],
  role: Rule.in(["admin", "editor"]),
});
```

Empty values skip later rules when the field is `nullable`. Without `nullable`, `required` fails on a missing or empty value, and other rules also skip empty values unless the rule itself is about presence (`required`, `filled`, `present`, `missing`, `prohibited`).

### Displaying the validation errors

The redirected view receives `errors`. `@error` prints the first message for one field. `message` inside the block is that string.

```html title="resources/views/users/create.view"
<form method="POST" action="/users">
  <input type="hidden" name="_token" value="{{ csrf_token() }}">

  <label for="email">Email</label>
  <input id="email" name="email" value="{{ old('email') }}">
  @error('email')
    <p>{{ message }}</p>
  @enderror

  <button type="submit">Save</button>
</form>
```

### Repopulating forms

`old('email')` prints the flashed input. Pass a second argument when the first visit should show a stored value:

```html
<input name="title" value="{{ old('title', user.title) }}">
```

### A note on optional fields

Mark optional fields `nullable`. An empty string then passes. Do not use `required` on a checkbox the user may leave unchecked. Use `boolean` or omit the field from the rules and read it yourself.

### Validation error response format

JSON clients receive `message` and `errors`. `errors` is a map of field name to an array of strings. The HTTP status is 422.

## Form request validation

A form request is a class that holds authorization and rules. It extends `FormRequest` from `@bunyad/http`.

```shell
bunyad make:request StoreUserRequest
```

If you write the file by hand, this is the shape:

```ts title="app/Http/Requests/StoreUserRequest.ts"
import { FormRequest } from "@bunyad/http";

export default class StoreUserRequest extends FormRequest {
  authorize() {
    return true;
  }

  rules() {
    return {
      name: "required|string|max:255",
      email: "required|email",
      password: "required|string|min:8|confirmed",
    };
  }
}
```

`from` copies the current request, runs `authorize`, then the rules.

```ts
import StoreUserRequest from "@/Http/Requests/StoreUserRequest.ts";

Route.post("/users", async (request) => {
  const form = await StoreUserRequest.from(request);
  const data = form.validated();
  return json(data, 201);
});
```

### Authorizing form requests

`authorize` returns `false` to stop before the rules run. The default failure is 403, "This action is unauthorized." Override `failedAuthorization` to change that response.

```ts
authorize() {
  return requestUserCanUpdate(this);
}
```

### Customizing the error messages

`messages()` returns a map. Keys are `field.rule` or the rule name. `attributes()` replaces the field name inside the default sentences.

```ts
attributes() {
  return { email: "email address" };
}

messages() {
  return { "email.required": "We need your email address." };
}
```

The same two maps are the `attributes` and `messages` options on `validate`.

Default English strings live in `@bunyad/validation` (`enValidationMessages`, or `lang/en/validation.ts` in the package). Apps can replace or merge them for every validator:

```ts
import {
  addDefaultMessages,
  setDefaultMessages,
  resetDefaultMessages,
  enValidationMessages,
} from "@bunyad/validation";

// Override a few rules (keeps the rest).
addDefaultMessages({
  accepted: "You must accept :attribute.",
});

// Or replace the whole catalog (e.g. another locale).
setDefaultMessages({
  ...enValidationMessages,
  required: "Il campo :attribute è obbligatorio.",
});

// Restore the packaged English defaults (handy in tests).
resetDefaultMessages();
```

`Validator.setDefaultMessages` / `Validator.addDefaultMessages` call the same helpers. Per-field `messages` on `validate` or a form request still win over the defaults. Templates may use `:attribute`, `:other`, `:value`, `:date`, `:format`, `:values`, and `:0` / `:1` for positional parameters.

### Preparing input for validation

`prepareForValidation` runs after authorization and before the rules. Call `this.failOnUnknownFields()` there when extra keys should fail. A nested key is known when the rule is the parent or `parent.*`.

```ts
prepareForValidation() {
  this.failOnUnknownFields();
  this.merge({ slug: this.string("title").toLowerCase() });
}
```

`validationData` is the object that is checked. It defaults to `all()`. `passedValidation` runs after the rules succeed.

`validated()` returns the passing bag. `validated("email")` returns one field, with an optional default. `safe()` wraps the bag. `safe(["email", "name"])` returns only those keys.

`uniqueExcept(table, column, except, idColumn)` builds a `unique` rule that ignores one id. `uniqueExceptRouteModel` does that with the id bound on the route.

## Manually creating validators

`validator(data, rules)` returns a `Validator` and does not throw. `validate()` throws `ValidationException`. `fails()` runs the rules and returns a boolean. `errors()` is the map of field to messages after `fails()` or a caught failure.

```ts
import { validator } from "@bunyad/validation";

const check = validator(request.all(), {
  email: "required|email",
});

if (await check.fails()) {
  return json({ errors: check.errors() }, 422);
}

const data = await check.validate();
```

`setCustomMessages` and `setAttributeNames` match `messages()` and `attributes()`. `after(callback)` runs after the rules, so you can add an error the built-in rules do not cover. `stopOnFirstFailure()` stops at the first failing field. `addRules` merges more rules before `validate()`.

```ts
const check = validator(request.all(), { email: "required|email" });

check.after((v) => {
  if (taken(String(v.getData().email ?? ""))) {
    v.addFailure("email", "unique", "The email has already been taken.");
  }
});

await check.validate();
```

`MessageBag` is the object the exception carries. Read it from a caught `ValidationException` when you are not using the automatic redirect.

## Working with validated input

`validate` returns only fields that were present and passed. A `nullable` field that was empty is included as empty. Fields you did not list in the rules are not in the result, so the returned object is safe to pass to a create call.

Nested keys use dots: a rule `profile.name` reads `data.profile.name`.

## Available validation rules

A rule that does not mention empty values accepts an empty value and does not fail. Combine it with `required` or `filled` when the field must be present.

### required

The field must be present and not empty. Empty means `null`, `undefined`, `""`, an empty array, or an empty object.

### nullable

When the value is empty, the rest of the rules on that field are skipped.

### filled

The field may be absent. If it is present, it must not be empty.

### present

The field must exist in the input, even if the value is empty.

### missing

The field must not be in the input.

### email

The value must be a string containing `@` and a dot in the domain. Empty values pass.

### string

The value must be a string.

### numeric

The value must be a number, or a string that parses as one.

### integer

The value must be an integer, or a string of optional `-` and digits. `1.5` fails.

### boolean

Accepted values are `true`, `false`, `0`, `1`, `"0"`, `"1"`, `"true"`, `"false"`, `"on"`, `"off"`, `"yes"`, and `"no"`.

### array

The value must be an array.

### date

The value must be a string or number that `Date.parse` accepts.

### accepted

The value must be `yes`, `on`, `1`, `"true"`, boolean `true`, or number `1`. Use this for terms checkboxes. `Rule.accepted()`.

### declined

The opposite of `accepted`: `no`, `off`, `0`, `false`, or the matching number/boolean. `Rule.declined()`.

### accepted_if:other,value,…

Same as `accepted`, but only when another field equals one of the listed values. `Rule.acceptedIf("role", "admin")`.

### declined_if:other,value,…

Same as `declined`, gated on another field. `Rule.declinedIf("newsletter", "1")`.

### after:date

The value must be a date after the given date or field. `Rule.after("start")` or `Rule.after("2024-01-01")`.

### after_or_equal:date

A date on or after the given date or field. `Rule.afterOrEqual("start")`.

### before:date

A date before the given date or field. `Rule.before("end")`.

### before_or_equal:date

A date on or before the given date or field. `Rule.beforeOrEqual("end")`.

### date_equals:date

A date equal to the given date or field. `Rule.dateEquals("2024-01-15")`.

### date_format:format

The string must match the format tokens (`Y`, `y`, `m`, `n`, `d`, `j`, `H`, `G`, `i`, `s`, `a`, `A`, and literal separators). Example: `date_format:Y-m-d`. `Rule.dateFormat("Y-m-d H:i:s")`.

### gt:field|value

Greater than another field's size, or a numeric value when the field is `numeric` / `integer`. Strings compare by length, arrays by count, files by kilobytes. `Rule.gt("min")` or `Rule.gt(10)`.

### gte:field|value

Greater than or equal. `Rule.gte("min")`.

### lt:field|value

Less than. `Rule.lt("max")`.

### lte:field|value

Less than or equal. `Rule.lte(100)`.

### url

The value must be a string `new URL` accepts.

### min:n

Strings are measured by length, numbers by value, arrays by count, and uploaded files by kilobytes (rounded up).

### max:n

The same measurements, as an upper bound.

### between:min,max

The size must be between the two numbers, using the same measurements as `min` and `max`.

### size:n

The size must equal `n`.

### confirmed

`field_confirmation` must equal `field`. A password field named `password` looks for `password_confirmation`.

### same:other

The value must equal the other field.

### different:other

The value must not equal the other field.

### in:a,b

The value must be one of the listed options. `Rule.in(["admin", "editor"])` builds this string. `Rule.enum(MyEnum)` lists the enum's values.

### not_in:a,b

The value must not be one of the listed options. `Rule.notIn(values)`.

### alpha

Letters only, `A`–`Z` and `a`–`z`.

### alpha_num

Letters and digits.

### alpha_dash

Letters, digits, dashes, and underscores.

### ascii

The string must be 7-bit ASCII.

### lowercase

The string must equal its lowercase form.

### uppercase

The string must equal its uppercase form.

### uuid

The value must be a UUID string.

### ulid

The value must be a 26-character ULID.

### ip

The value must be an IPv4 or IPv6 address.

### ipv4

The value must be an IPv4 address. `Rule.ipv4()`.

### ipv6

The value must contain a colon and otherwise look like IPv6. `Rule.ipv6()`.

### json

The value must be a string `JSON.parse` accepts.

### contains:a,b

The value must be an array that includes every listed value. `Rule.contains(["a", "b"])`.

### doesnt_contain:a,b

The array must not include the listed values. `Rule.doesntContain(values)`.

### regex:pattern

The string must match the pattern. `Rule.regex("^\\d+$")`.

### not_regex:pattern

The string must not match. `Rule.notRegex(pattern)`.

### required_if:other,value

Required when another field equals one of the values. `Rule.requiredIf("role", "admin")`.

### required_unless:other,value

Required unless another field equals one of the values. `Rule.requiredUnless("role", "guest")`.

### required_with:a,b

Required when any listed field is present. `Rule.requiredWith("a", "b")`.

### required_with_all:a,b

Required when every listed field is present.

### required_without:a,b

Required when any listed field is missing. `Rule.requiredWithout("a")`.

### required_without_all:a,b

Required when every listed field is missing.

### prohibited

The field must be empty.

### prohibited_if:other,value

The field must be empty when another field has that value. `Rule.prohibitedIf("role", "guest")`.

### prohibited_unless:other,value

The field must be empty unless another field has that value. `Rule.prohibitedUnless("type", "admin")`.

### prohibits:a,b

When this field is filled, the listed fields must be empty.

### present_if / present_unless / present_with / present_with_all

The field key must exist in the input (value may be empty). Conditional forms mirror `required_*`.

### missing_if / missing_unless / missing_with / missing_with_all

The field key must be absent. Conditional forms mirror `required_*`.

### digits:value / digits_between:min,max

The value must be digits only, with an exact length or a length in range.

### decimal:min,max

A number with between `min` and `max` decimal places. One argument means an exact count.

### multiple_of:value

The numeric value must be a multiple of `value`.

### starts_with / ends_with / doesnt_start_with / doesnt_end_with

String prefix and suffix checks. Pass comma-separated candidates.

### hex_color / mac_address / timezone / active_url

Format checks. `timezone` uses IANA zones from `Intl`. `active_url` resolves the host (override with `setActiveUrlChecker` in tests).

### distinct / list / required_array_keys

`distinct` on wildcard attributes (`items.*.id`) rejects duplicate sibling values (`distinct:strict`, `distinct:ignore_case`). `list` requires a sequential array. `required_array_keys:a,b` requires those keys on an object.

### exclude / exclude_if / exclude_unless / exclude_with / exclude_without

Drop the attribute from validated output (and skip other rules for it). Pipe forms take other field names; `Rule.excludeIf(condition)` takes a boolean or callback.

### file

The value must be an uploaded file, and the upload must be valid.

### image

The upload's MIME type must start with `image/`.

### mimes:jpg,png

The original extension must be one of the listed types. `Rule.mimes("jpg", "png")`.

### dimensions

Constraints are `min_width`, `min_height`, `max_width`, `max_height`, `width`, `height`, and `ratio`. Ratio is `width/height`, compared within `0.01`. This rule reads the image through `@bunyad/image`.

```ts
"avatar": "required|image|dimensions:min_width=100,min_height=100"
```

`Rule.dimensions({ min_width: 100, min_height: 100 })` builds that string.

### unique:table,column,except,idColumn

The column must not already hold the value. `column` defaults to the field name. `except` is an id to ignore, and `idColumn` defaults to `id`. The check uses the presence verifier. Register one with `setPresenceVerifier`, or boot the database package so it registers one. Without a verifier the rule cannot see the database.

```ts
email: "required|email|unique:users,email",
```

On an update, ignore the current row:

```ts
email: `unique:users,email,${user.id},id`,
```

### exists:table,column

The column must already hold the value. `column` defaults to the field name. This uses the same presence verifier as `unique`.

### current_password

The value must match the authenticated user's password. Pass the user on `validate` as `user`, or call `setUser` on the validator. The framework registers the comparer. Without that comparer the rule cannot check a hash.

## Conditionally adding rules

`Rule.when(condition, rules, defaultRules)` includes `rules` when the condition is true, and `defaultRules` otherwise. `Rule.unless` inverts the condition. The condition may be a boolean or an async function.

```ts
await validate(request.all(), {
  reason: Rule.when(() => request.string("role") === "admin", "required|string"),
});
```

`Rule.excludeIf(condition)` drops the field from the validated output when the condition is true. `Rule.excludeUnless` drops it when the condition is false. Pipe tokens `exclude`, `exclude_if:other,value`, `exclude_unless`, `exclude_with`, and `exclude_without` do the same from rule strings.

`sometimes` as a pipe token skips the rest of the attribute's rules when the key is missing from the input. `bail` stops after the first failing rule on that attribute. `password` applies `Password.default()` / `Rule.password()` complexity rules.

`sometimes(attribute, rules, callback)` on a `Validator` adds rules only when the callback returns true. Omit the callback to add them when the field is present.

```ts
const check = validator(request.all(), { email: "email" });
check.sometimes("company", "required|string", (input) => input.role === "admin");

await validate(request.all(), {
  bio: "sometimes|required|string",
  password: "required|password",
  nickname: "bail|required|min:3|alpha",
});
```

On an HTTP request, `request.validateWithBag("post", rules)` flashes the field error map under a named bag (`errors.post`). Views read it with `@error('title', 'post')`. The default `@error('email')` still reads a flat `errors.email` or `errors.default.email`.

```ts
await request.validateWithBag("post", {
  title: "required|max:255",
  body: "required",
});
```

`Rule.unique` / `Rule.exists` accept `where("col", value)`, `whereNull("col")`, and `where((q) => q.where("a", 1).whereNull("b"))`. Those clauses reach the presence verifier (SQL uses `IS NULL` for nulls).

## Validating arrays

Validate each element with `*`.

```ts
await validate(request.all(), {
  "items.*.email": "required|email",
  "items.*.qty": "required|integer|min:1",
});
```

The error keys keep the index: `items.0.email`.

## Validating files

Uploaded files use `file`, `image`, `mimes`, and `dimensions`. `min` and `max` are kilobytes. Read the file from the request with `request.file("avatar")` after validation. See [Requests](/docs/1.x/requests).

```ts
await validate(request.all(), {
  avatar: "required|image|mimes:jpg,png|max:2048",
});
```

## Validating passwords

`Password` from `@bunyad/validation` is a rule object. `Password.min(8)` starts a builder. Chain `letters()`, `mixedCase()`, `numbers()`, `symbols()`, and `uncompromised(threshold)`. `uncompromised` checks the Have I Been Pwned range API and fails when the password appears more than `threshold` times. A network failure does not fail the rule. `withMessage` replaces the default sentence.

```ts
import { Password, validate } from "@bunyad/validation";

await validate(request.all(), {
  password: ["required", Password.min(8).letters().numbers()],
});
```

`Password.defaults(() => Password.min(12).letters())` sets the builder `Rule.password()` uses. `Rule.password()` with no defaults is `Password.min(8)`.

## Custom validation rules

A custom rule is an object with `passes(attribute, value, data)` and `message()`. `passes` may be async. Return `false` to fail.

```ts
import type { ValidationRule } from "@bunyad/validation";

const even: ValidationRule = {
  passes(_attribute, value) {
    return typeof value === "number" && value % 2 === 0;
  },
  message() {
    return "The value must be even.";
  },
};

await validate(request.all(), { count: ["required", "integer", even] });
```

`Validator.extend(name, callback)` registers a string rule for the process. The callback returns a message key to fail, or nothing to pass. It has the same shape as the built-in rules.

`Can` and `CanAny` ask an ability checker, which the auth package registers, whether the current user may perform an ability. The field value is the last argument. Without a checker those rules cannot authorize.
