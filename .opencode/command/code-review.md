---
description: Analyzes code changes and provides comprehensive code review feedback
---

# Code Review Command

## Description

Analyzes code changes and provides comprehensive code review feedback, including suggestions for improvements, potential issues, and best practices.

## Usage

- `/code-review` - Review staged changes
- `/code-review all` - Review all uncommitted changes (including unstaged)
- `/code-review file <path>` - Review a specific file
- `/code-review branch <branch-name>` - Review changes compared to another branch
- `/code-review commit <sha>` - Review a specific commit's content

## AI Instructions

When this command is invoked, you should:

1. Determine the review scope based on the arguments provided:
   - No arguments: Review staged changes using `git diff --cached`
   - "all": Review all changes using `git diff`
   - "file <path>": Review specific file using `git diff <path>`
   - "branch <branch-name>": Review branch diff using `git diff <branch-name>`
   - "commit <sha>": Review specific commit using `git show <sha>`

2. If no changes are found for the specified scope:
   - Inform the user that no changes were found
   - Suggest alternative review options

3. Analyze the code changes and provide feedback on:
   - **Code Quality**: Readability, maintainability, and structure
   - **Best Practices**: Language-specific conventions and patterns
   - **Potential Issues**: Bugs, security vulnerabilities, performance concerns
   - **Testing**: Test coverage and test quality
   - **Documentation**: Code comments and documentation completeness
   - **Architecture**: Design patterns and architectural decisions

4. Structure your review with:
   - **Summary**: Brief overview of changes and overall assessment
   - **Highlights**: Positive aspects of the changes
   - **Concerns**: Issues that need attention
   - **Suggestions**: Recommendations for improvement
   - **Questions**: Clarifications needed from the author

5. Use constructive and respectful language throughout the review

6. For each issue found, provide:
   - Clear description of the problem
   - Location in the code (file and line numbers when applicable)
   - Suggested solution or improvement
   - Rationale for the suggestion

7. Prioritize feedback by severity:
   - **Critical**: Must fix before merging (security, breaking changes)
   - **Important**: Should fix (performance, maintainability)
   - **Nice to have**: Optional improvements

## Review Categories

### Code Quality

- Code readability and clarity
- Consistent naming conventions
- Proper error handling
- Code organization and structure

### Best Practices

- Language-specific idioms
- Design patterns usage
- SOLID principles adherence
- DRY (Don't Repeat Yourself) principle

### Potential Issues

- Logic errors
- Security vulnerabilities
- Performance bottlenecks
- Resource leaks
- Edge cases not handled

### Testing

- Test coverage
- Test quality and relevance
- Test organization
- Mocking and isolation

### Documentation

- Code comments
- Function documentation
- README updates
- API documentation

## Example Output

```bash
# Code Review for changes in feature/authentication

## Summary
This PR implements user authentication with JWT tokens. The implementation is solid overall but has some security concerns that should be addressed before merging.

## Highlights
- Clean separation of concerns with dedicated auth service
- Comprehensive error handling
- Good use of environment variables for configuration
- Proper password hashing with bcrypt

## Concerns

### Critical
- **JWT secret exposure**: The JWT secret is hardcoded in `auth.js:45`. This should be moved to environment variables.
- **Missing token expiration**: JWT tokens don't have an expiration set, which is a security risk.

### Important
- **Password validation**: Password requirements are not enforced on the server side.
- **Error messages**: Generic error messages may leak information about user existence.

## Suggestions

1. Move JWT secret to environment variables
2. Set reasonable token expiration (e.g., 1 hour)
3. Implement password strength validation
4. Use generic error messages for authentication failures
5. Add rate limiting to prevent brute force attacks

## Questions

1. Have you considered implementing refresh tokens?
2. Is there a reason for not using a more established auth library?
```

## Important Notes

- **Context Awareness**: Consider the project's existing patterns and conventions
- **Constructive Feedback**: Focus on improvement rather than criticism
- **Specific Examples**: Provide concrete examples for each suggestion
- **Alternative Solutions**: When pointing out issues, suggest specific alternatives
- **Balance**: Balance between thoroughness and overwhelming the author
